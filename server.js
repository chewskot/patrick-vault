const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');
const session = require('express-session');
require('dotenv').config();

const app = express();
const db = new Database('lego.db');

// --- INICIALIZACE DATABÁZE ---
db.prepare(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_num TEXT UNIQUE,
    name TEXT,
    year INTEGER,
    theme TEXT,
    img_url TEXT,
    quantity INTEGER DEFAULT 1
)`).run();

// --- NASTAVENÍ APLIKACE ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'lego-vault-super-secret',
    resave: false,
    saveUninitialized: true
}));

const REBRICKABLE_API_KEY = process.env.REB_KEY ? process.env.REB_KEY.trim() : null;

// --- POMOCNÉ FUNKCE ---

async function fetchAndSaveSet(setNum, quantity) {
    if (!REBRICKABLE_API_KEY) return false;

    try {
        // Kontrola, zda set již existuje
        const existing = db.prepare("SELECT quantity FROM inventory WHERE set_num = ?").get(setNum);
        
        if (existing) {
            // AKTUALIZACE: Přičtení množství k existujícímu záznamu
            const newQty = existing.quantity + quantity;
            db.prepare("UPDATE inventory SET quantity = ? WHERE set_num = ?").run(newQty, setNum);
            console.log(`📈 Množství setu ${setNum} zvýšeno na ${newQty}`);
            return true;
        }

        // Pokud neexistuje, stáhneme data z API
        const res = await axios.get(`https://rebrickable.com/api/v3/lego/sets/${setNum}-1/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        
        const themeRes = await axios.get(`https://rebrickable.com/api/v3/lego/themes/${res.data.theme_id}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });

        const { name, year, set_img_url } = res.data;
        const themeName = themeRes.data.name;

        db.prepare(`
            INSERT INTO inventory (set_num, name, year, theme, img_url, quantity) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(setNum, name, year, themeName, set_img_url, quantity);
        
        return true;
    } catch (e) {
        console.error(`❌ Chyba u setu ${setNum}: ${e.message}`);
        return false;
    }
}

const isAdmin = (req, res, next) => {
    if (req.session.isLogged) next();
    else res.redirect('/login');
};

// --- ROUTY ---

app.get('/', (req, res) => {
    const { search, year, theme } = req.query;
    let query = "SELECT * FROM inventory WHERE 1=1";
    let params = [];

    if (search) {
        query += " AND (name LIKE ? OR set_num LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    if (year) {
        query += " AND year = ?";
        params.push(year);
    }
    if (theme) {
        query += " AND theme = ?";
        params.push(theme);
    }

    const sets = db.prepare(query).all(...params);
    const years = db.prepare("SELECT DISTINCT year FROM inventory ORDER BY year DESC").all();
    const themes = db.prepare("SELECT DISTINCT theme FROM inventory ORDER BY theme ASC").all();
    const stats = db.prepare("SELECT COUNT(*) as totalSets, SUM(quantity) as totalItems FROM inventory").get();

    res.render('index', { 
        sets, 
        stats: stats || { totalSets: 0, totalItems: 0 },
        search: search || '', 
        years, themes, 
        currentYear: year || '', 
        currentTheme: theme || '' 
    });
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
    const MY_PASSWORD = process.env.ADMIN_PASS;
    if (req.body.password === MY_PASSWORD) {
        req.session.isLogged = true;
        res.redirect('/admin');
    } else {
        res.send("Špatné heslo! <a href='/login'>Zkusit znovu</a>");
    }
});

app.get('/admin', isAdmin, (req, res) => {
    const sets = db.prepare("SELECT * FROM inventory ORDER BY id DESC").all();
    res.render('admin', { sets });
});

app.post('/add', isAdmin, async (req, res) => {
    await fetchAndSaveSet(req.body.set_num, parseInt(req.body.quantity));
    res.redirect('/admin');
});

// NOVÁ ROUTA: Úprava množství
app.post('/update-quantity/:id', isAdmin, (req, res) => {
    const { quantity } = req.body;
    db.prepare("UPDATE inventory SET quantity = ? WHERE id = ?").run(parseInt(quantity), req.params.id);
    res.redirect('/admin');
});

app.post('/delete/:id', isAdmin, (req, res) => {
    db.prepare("DELETE FROM inventory WHERE id = ?").run(req.params.id);
    res.redirect('/admin');
});

app.get('/import-home', async (req, res) => {
    const myHomeInventory = [
        { id: "75388", q: 1 }, { id: "75394", q: 1 }, { id: "75398", q: 1 }, { id: "75393", q: 1 },
        { id: "75433", q: 1 }, { id: "75638", q: 1 }, { id: "75441", q: 1 }, { id: "75401", q: 1 },
        { id: "75639", q: 1 }, { id: "75374", q: 1 }, { id: "40796", q: 1 }, { id: "75399", q: 1 },
        { id: "75396", q: 1 }, { id: "75434", q: 1 }, { id: "75413", q: 1 }, { id: "75435", q: 1 },
        { id: "40765", q: 1 }, { id: "75414", q: 1 }, { id: "75637", q: 1 }, { id: "40806", q: 1 },
        { id: "75381", q: 1 }, { id: "75385", q: 1 }, { id: "75636", q: 1 }, { id: "75416", q: 1 },
        { id: "75342", q: 2 }, { id: "75402", q: 1 }, { id: "75373", q: 15 }, { id: "75345", q: 3 },
        { id: "75359", q: 1 }, { id: "40755", q: 5 }, { id: "75412", q: 11 }, { id: "75372", q: 4 },
        { id: "75431", q: 1 }, { id: "75407", q: 1 }, { id: "75405", q: 1 }, { id: "75404", q: 2 },
        { id: "75400", q: 1 }, { id: "40658", q: 1 }, { id: "40597", q: 1 }, { id: "40602", q: 1 },
        { id: "75411", q: 1 }, { id: "40179", q: 1 }, { id: "75367", q: 1 }
    ];
    for (const item of myHomeInventory) {
        await fetchAndSaveSet(item.id, item.q);
        await new Promise(r => setTimeout(r, 1000));
    }
    res.send("<h1>Import hotov!</h1><a href='/'>Zobrazit galerii</a>");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));