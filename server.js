require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 5000;

// PostgreSQL Connection Pool using Supabase IPv4 Pooler URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());

// Initialize Database Tables & Migration
const initDb = async () => {
  try {
    // 1. Base table creation (if tables don't exist)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        phone VARCHAR(20),
        password VARCHAR(100),
        role VARCHAR(20) DEFAULT 'patient',
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
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        patient_id VARCHAR(50),
        phone VARCHAR(20),
        amount NUMERIC,
        status VARCHAR(20) DEFAULT 'PENDING',
        reference VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Safe Schema Migration for existing tables in Supabase
    await pool.query(`
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS category VARCHAR(50);
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS calories VARCHAR(20);
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20);
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    console.log("🚀 Database tables & schema migrations initialized successfully!");
  } catch (err) {
    console.error("DB Init Error:", err.message);
  }
};
initDb();

// 1. Health Check Endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbTest = await pool.query('SELECT NOW()');
    res.json({ status: "online", dbTime: dbTest.rows[0].now, message: "Admet Server Connected to Supabase!" });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// 2. Authentication APIs
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

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, phone, role, is_paid, created_at FROM users ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. ClickPesa Live Payment Endpoint (Real USSD STK Push)
app.post('/api/payments/stk-push', async (req, res) => {
  const { patientId, phone, amount } = req.body;
  const paymentAmount = amount || 100000;

  // Format phone number to international format (255XXXXXXXXX)
  let formattedPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '255' + formattedPhone.slice(1);
  }

  // Strictly alphanumeric order reference (no hyphens or special chars)
  const cleanOrderRef = `ADMET${patientId}${Date.now()}`;

  try {
    // Step 1: Request JWT Authorization Token from ClickPesa
    const tokenResponse = await fetch('https://api.clickpesa.com/third-parties/generate-token', {
      method: 'POST',
      headers: {
        'api-key': process.env.CLICKPESA_API_KEY,
        'client-id': process.env.CLICKPESA_CLIENT_ID
      }
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.token) {
      console.error("ClickPesa Auth Error Details:", tokenData);
      return res.status(400).json({ 
        success: false, 
        error: "Failed to authenticate with ClickPesa.", 
        clickpesaError: tokenData 
      });
    }

    // Step 2: Initiate USSD Push Request
    const paymentResponse = await fetch('https://api.clickpesa.com/third-parties/payments/initiate-ussd-push-request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tokenData.token
      },
      body: JSON.stringify({
        amount: String(paymentAmount),
        currency: "TZS",
        phoneNumber: formattedPhone,
        orderReference: cleanOrderRef
      })
    });

    const paymentResult = await paymentResponse.json();

    if (paymentResponse.ok) {
      await pool.query(
        'INSERT INTO transactions (patient_id, phone, amount, status, reference) VALUES ($1, $2, $3, $4, $5)',
        [patientId, formattedPhone, paymentAmount, 'PENDING', cleanOrderRef]
      );

      res.json({
        success: true,
        message: "USSD Prompt sent to phone.",
        paymentResult
      });
    } else {
      console.error("ClickPesa STK Push Failed:", paymentResult);
      res.status(400).json({ 
        success: false, 
        error: paymentResult.message || "STK Push request failed", 
        paymentResult 
      });
    }

  } catch (err) {
    console.error("Payment Server Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Diabetic Foods API
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

// 5. Exercise Videos API (Updated to support new metadata fields & thumbnails)
app.get('/api/videos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/videos', async (req, res) => {
  const { 
    title, 
    targetArea, 
    duration, 
    url, 
    thumbnailUrl, 
    category, 
    calories, 
    difficulty, 
    description 
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO videos 
        (title, target_area, duration, url, thumbnail_url, category, calories, difficulty, description) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [
        title, 
        targetArea || null, 
        duration || null, 
        url, 
        thumbnailUrl || null, 
        category || null, 
        calories || null, 
        difficulty || null, 
        description || null
      ]
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

// 6. Glucose Logs API
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

// 7. Messaging API
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

// 8. Create HTTP Server & Mount WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('⚡ Client connected via WebSocket');

  ws.on('message', (message) => {
    console.log('Received:', message.toString());
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected');
  });
});

// Start unified server
server.listen(PORT, () => {
  console.log(`🚀 Admet Server running on port ${PORT}`);
});