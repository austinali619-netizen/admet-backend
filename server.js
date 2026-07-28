require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());

// Initialize Database Tables
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        phone VARCHAR(20),
        password VARCHAR(100),
        role VARCHAR(20) DEFAULT 'patient', -- 'patient' or 'doctor'
        is_paid BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS foods (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        category VARCHAR(50),
        carbs INT,
        portion VARCHAR(50),
        image VARCHAR(255)
      );
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100),
        target_area VARCHAR(50),
        duration VARCHAR(20),
        url VARCHAR(255)
      );
      CREATE TABLE IF NOT EXISTS glucose_logs (
        id SERIAL PRIMARY KEY,
        patient_id VARCHAR(50),
        value NUMERIC,
        unit VARCHAR(10),
        context VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        patient_id VARCHAR(50),
        sender VARCHAR(20),
        text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables initialized with Users support!");
  } catch (err) {
    console.error("DB Init Error:", err.message);
  }
};
initDb();

// 1. Health Check
app.get('/api/health', async (req, res) => {
  try {
    const dbTest = await pool.query('SELECT NOW()');
    res.json({ status: "online", dbTime: dbTest.rows[0].now, message: "Admet Server Connected to Supabase!" });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// 2. Authentication APIs (Sign Up & Log In)
app.post('/api/register', async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    const userRole = role || 'patient';
    const result = await pool.query(
      'INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, phone, role, is_paid',
      [name, email, phone, password, userRole]
    );
    res.status(201).json({ message: "Registration successful", user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: "Email or phone already registered" });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, role, is_paid FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({ message: "Login successful", user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get All Registered Users (For Admin Analytics)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, phone, role, is_paid, created_at FROM users ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Diabetic Foods API
app.get('/api/foods', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM foods ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/foods', async (req, res) => {
  const { name, category, carbs, portion, image } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO foods (name, category, carbs, portion, image) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, category, carbs, portion, image]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/foods/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM foods WHERE id = $1', [req.params.id]);
    res.json({ message: "Food item deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Exercise Videos API
app.get('/api/videos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/videos', async (req, res) => {
  const { title, targetArea, duration, url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO videos (title, target_area, duration, url) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, targetArea, duration, url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/videos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
    res.json({ message: "Video deleted successfully", deletedId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Glucose Monitoring API
app.get('/api/glucose/:patientId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM glucose_logs WHERE patient_id = $1 ORDER BY created_at DESC', [req.params.patientId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/glucose', async (req, res) => {
  const { patientId, value, unit, context } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO glucose_logs (patient_id, value, unit, context) VALUES ($1, $2, $3, $4) RETURNING *',
      [patientId, value, unit, context]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Consultation Messages API
app.get('/api/messages/:patientId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages WHERE patient_id = $1 ORDER BY created_at ASC', [req.params.patientId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const { patientId, sender, text } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO messages (patient_id, sender, text) VALUES ($1, $2, $3) RETURNING *',
      [patientId, sender, text]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Admet Server running on port ${PORT}`);
});