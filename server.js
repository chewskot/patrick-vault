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
        const existing = db.prepare("SELECT quantity FROM inventory WHERE set_num = ?").get(setNum);
        if (existing) {
            const newQty = existing.quantity + quantity;
            db.prepare("UPDATE inventory SET quantity = ? WHERE set_num = ?").run(newQty, setNum);
            return true;
        }

        const res = await axios.get(`https://rebrickable.com/api/v3/lego/sets/${setNum}-1/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        const themeRes = await axios.get(`https://rebrickable.com/api/v3/lego/themes/${res.data.theme_id}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });

        db.prepare(`INSERT INTO inventory (set_num, name, year, theme, img_url, quantity) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(setNum, res.data.name, res.data.year, themeRes.data.name, res.data.set_img_url, quantity);
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
    if (search) { query += " AND (name LIKE ? OR set_num LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
    if (year) { query += " AND year = ?"; params.push(year); }
    if (theme) { query += " AND theme = ?"; params.push(theme); }

    const sets = db.prepare(query).all(...params);
    const years = db.prepare("SELECT DISTINCT year FROM inventory ORDER BY year DESC").all();
    const themes = db.prepare("SELECT DISTINCT theme FROM inventory ORDER BY theme ASC").all();
    const stats = db.prepare("SELECT COUNT(*) as totalSets, SUM(quantity) as totalItems FROM inventory").get();

    res.render('index', { sets, stats: stats || { totalSets: 0, totalItems: 0 }, search: search || '', years, themes, currentYear: year || '', currentTheme: theme || '' });
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
    if (req.body.password === process.env.ADMIN_PASS) {
        req.session.isLogged = true;
        res.redirect('/admin');
    } else { res.send("Špatné heslo!"); }
});

app.get('/admin', isAdmin, (req, res) => {
    const sets = db.prepare("SELECT * FROM inventory ORDER BY id DESC").all();
    res.render('admin', { sets });
});

// HROMADNÝ IMPORT Z TEXTU
app.post('/bulk-import', isAdmin, async (req, res) => {
    const text = req.body.importData;
    const lines = text.split('\n');
    console.log("--- START BULK IMPORTU ---");
    
    for (const line of lines) {
        const match = line.match(/(\d+)x\s+(\d+)/);
        if (match) {
            const quantity = parseInt(match[1]);
            const setNum = match[2];
            await fetchAndSaveSet(setNum, quantity);
            await new Promise(r => setTimeout(r, 1000)); // Pauza proti 429
        }
    }
    res.redirect('/admin');
});

app.post('/update-quantity/:id', isAdmin, (req, res) => {
    db.prepare("UPDATE inventory SET quantity = ? WHERE id = ?").run(parseInt(req.body.quantity), req.params.id);
    res.redirect('/admin');
});

app.post('/delete/:id', isAdmin, (req, res) => {
    db.prepare("DELETE FROM inventory WHERE id = ?").run(req.params.id);
    res.redirect('/admin');
});

// SMAZÁNÍ CELÉ DB S OVĚŘENÍM HESLA
app.post('/clear-inventory', isAdmin, (req, res) => {
    if (req.body.confirmPassword === process.env.ADMIN_PASS) {
        db.prepare("DELETE FROM inventory").run();
        console.log("💥 Celá databáze byla smazána!");
        res.redirect('/admin');
    } else {
        res.send("Špatné heslo pro smazání! <a href='/admin'>Zpět</a>");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží...`));