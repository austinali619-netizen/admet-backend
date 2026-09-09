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

// ==========================================
// DATABASE INITIALIZATION & MIGRATIONS
// ==========================================

// 1. Admet Database Initialization
const initDb = async () => {
  try {
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

    await pool.query(`
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS category VARCHAR(50);
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS calories VARCHAR(20);
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20);
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    console.log("🚀 Admet DB initialized!");
  } catch (err) {
    console.error("Admet DB Init Error:", err.message);
  }
};

// 2. PlanB Database Initialization
const initPlanbDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS planb_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'client', -- 'client' or 'technician'
        subscription_active BOOLEAN DEFAULT false,
        subscription_expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planb_technician_profiles (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES planb_users(id) ON DELETE CASCADE,
        categories TEXT[],
        skills TEXT[],
        location VARCHAR(100),
        total_tasks INT DEFAULT 0,
        likes INT DEFAULT 0,
        dislikes INT DEFAULT 0,
        bio TEXT,
        portfolio_urls TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planb_messages (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES planb_users(id),
        technician_id INT REFERENCES planb_users(id),
        sender_id INT REFERENCES planb_users(id),
        text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planb_transactions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES planb_users(id),
        phone VARCHAR(20),
        amount NUMERIC NOT NULL,
        plan_type VARCHAR(50) DEFAULT 'MONTHLY_SUBSCRIPTION',
        status VARCHAR(20) DEFAULT 'PENDING',
        reference VARCHAR(100) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planb_favorites (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES planb_users(id),
        technician_id INT REFERENCES planb_users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planb_reviews (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES planb_users(id),
        technician_id INT REFERENCES planb_users(id),
        rating INT CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("🚀 PlanB DB initialized!");
  } catch (err) {
    console.error("PlanB DB Init Error:", err.message);
  }
};

initDb();
initPlanbDb();

// ==========================================
// ADMET APIS
// ==========================================

app.get('/api/health', async (req, res) => {
  try {
    const dbTest = await pool.query('SELECT NOW()');
    res.json({ status: "online", dbTime: dbTest.rows[0].now, message: "Admet & PlanB Server Online!" });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

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

app.post('/api/payments/stk-push', async (req, res) => {
  const { patientId, phone, amount } = req.body;
  const paymentAmount = amount || 100000;

  let formattedPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '255' + formattedPhone.slice(1);
  }

  const cleanOrderRef = `ADMET${patientId}${Date.now()}`;

  try {
    const tokenResponse = await fetch('https://api.clickpesa.com/third-parties/generate-token', {
      method: 'POST',
      headers: {
        'api-key': process.env.CLICKPESA_API_KEY,
        'client-id': process.env.CLICKPESA_CLIENT_ID
      }
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.token) {
      return res.status(400).json({ success: false, error: "Authentication failed", clickpesaError: tokenData });
    }

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
      res.json({ success: true, message: "USSD Prompt sent.", paymentResult });
    } else {
      res.status(400).json({ success: false, error: paymentResult.message || "STK Push failed", paymentResult });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

app.get('/api/videos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/videos', async (req, res) => {
  const { title, targetArea, duration, url, thumbnailUrl, category, calories, difficulty, description } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO videos (title, target_area, duration, url, thumbnail_url, category, calories, difficulty, description) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [title, targetArea || null, duration || null, url, thumbnailUrl || null, category || null, calories || null, difficulty || null, description || null]
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

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const status = payload.status || payload.event;
    const reference = payload.reference || payload.orderReference;
    const clientPhone = payload.phoneNumber || payload.phone || payload.msisdn;

    if (status === 'PAYMENT RECEIVED' || status === 'SUCCESS' || status === 'PAID' || status === 'COMPLETED') {
      if (reference) {
        await pool.query("UPDATE transactions SET status = 'COMPLETED' WHERE reference = $1", [reference]);
      }
      if (clientPhone) {
        let cleanPhone = String(clientPhone).replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('0')) cleanPhone = '255' + cleanPhone.slice(1);
        await pool.query("UPDATE users SET is_paid = true WHERE phone LIKE $1", [`%${cleanPhone.slice(-9)}`]);
      }
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ app: 'admet', event: 'PAYMENT_SUCCESS', reference, phone: clientPhone }));
        }
      });
    } else if (status === 'PAYMENT FAILED' || status === 'FAILED') {
      if (reference) {
        await pool.query("UPDATE transactions SET status = 'FAILED' WHERE reference = $1", [reference]);
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// PLANB APIS
// ==========================================

// Register PlanB User
app.post('/api/planb/register', async (req, res) => {
  const { name, phone, password, role } = req.body;
  try {
    const userRole = role === 'technician' ? 'technician' : 'client';
    const result = await pool.query(
      'INSERT INTO planb_users (name, phone, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, phone, role, subscription_active',
      [name, phone, password, userRole]
    );

    const user = result.rows[0];

    // Create blank profile if registering as technician
    if (userRole === 'technician') {
      await pool.query('INSERT INTO planb_technician_profiles (user_id) VALUES ($1)', [user.id]);
    }

    res.status(201).json({ message: "PlanB Registration successful", user });
  } catch (err) {
    res.status(400).json({ error: "Phone number already registered" });
  }
});

// Login PlanB User
app.post('/api/planb/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT id, name, phone, role, subscription_active, subscription_expires_at FROM planb_users WHERE phone = $1 AND password = $2',
      [phone, password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }
    res.json({ message: "Login successful", user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch Technicians
app.get('/api/planb/technicians', async (req, res) => {
  const { category, location } = req.query;
  try {
    let query = `
      SELECT u.id, u.name, u.phone, p.categories, p.skills, p.location, p.total_tasks, p.likes, p.dislikes, p.bio, p.portfolio_urls
      FROM planb_users u
      JOIN planb_technician_profiles p ON u.id = p.user_id
      WHERE u.role = 'technician'
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND $${params.length} = ANY(p.categories)`;
    }

    if (location) {
      params.push(`%${location}%`);
      query += ` AND p.location ILIKE $${params.length}`;
    }

    query += ' ORDER BY p.likes DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PlanB Subscription Payment (STK Push)
app.post('/api/planb/payments/subscription-stk', async (req, res) => {
  const { userId, phone, amount } = req.body;
  const paymentAmount = amount || 5000; // Default subscription rate TZS 5,000

  let formattedPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '255' + formattedPhone.slice(1);
  }

  const cleanOrderRef = `PLANB${userId}${Date.now()}`;

  try {
    const tokenResponse = await fetch('https://api.clickpesa.com/third-parties/generate-token', {
      method: 'POST',
      headers: {
        'api-key': process.env.CLICKPESA_API_KEY,
        'client-id': process.env.CLICKPESA_CLIENT_ID
      }
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.token) {
      return res.status(400).json({ success: false, error: "Authentication failed", clickpesaError: tokenData });
    }

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
        'INSERT INTO planb_transactions (user_id, phone, amount, status, reference) VALUES ($1, $2, $3, $4, $5)',
        [userId, formattedPhone, paymentAmount, 'PENDING', cleanOrderRef]
      );
      res.json({ success: true, message: "Subscription USSD prompt sent.", paymentResult });
    } else {
      res.status(400).json({ success: false, error: paymentResult.message || "STK Push failed", paymentResult });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PlanB Dedicated Webhook Handler
app.post('/api/planb/payments/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const status = payload.status || payload.event;
    const reference = payload.reference || payload.orderReference;
    const clientPhone = payload.phoneNumber || payload.phone || payload.msisdn;

    console.log("Received PlanB Webhook Notification:", payload);

    if (status === 'PAYMENT RECEIVED' || status === 'SUCCESS' || status === 'PAID' || status === 'COMPLETED') {
      if (reference) {
        await pool.query("UPDATE planb_transactions SET status = 'COMPLETED' WHERE reference = $1", [reference]);
      }

      if (clientPhone) {
        let cleanPhone = String(clientPhone).replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('0')) cleanPhone = '255' + cleanPhone.slice(1);

        // Activate subscription for 30 days
        await pool.query(
          `UPDATE planb_users 
           SET subscription_active = true, 
               subscription_expires_at = NOW() + INTERVAL '30 days' 
           WHERE phone LIKE $1`,
          [`%${cleanPhone.slice(-9)}`]
        );
      }

      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ app: 'planb', event: 'SUBSCRIPTION_SUCCESS', reference, phone: clientPhone }));
        }
      });
    } else if (status === 'PAYMENT FAILED' || status === 'FAILED') {
      if (reference) {
        await pool.query("UPDATE planb_transactions SET status = 'FAILED' WHERE reference = $1", [reference]);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("PlanB Webhook Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SERVER & WEBSOCKET SETUP
// ==========================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('⚡ Client connected via WebSocket');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Route WS broadcasts by app
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify(data));
        }
      });
    } catch (e) {
      console.log('Received raw message:', message.toString());
    }
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Admet & PlanB Unified Server running on port ${PORT}`);
});
