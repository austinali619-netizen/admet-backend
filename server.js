// ==========================================
// ADMET DIABETES PLATFORM - BACKEND SERVER
// ==========================================

const express = require('express');
const cors = require('cors');

const app = express();

// Enable CORS so Android App and Web Dashboard can communicate with server
app.use(cors());
app.use(express.json());

// Middleware: Verify Bypass-Tunnel-Reminder header (for LocalTunnel)
app.use((req, res, next) => {
  // Allow requests and handle the custom tunnel header
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Bypass-Tunnel-Reminder");
  next();
});

// ==========================================
// MOCK IN-MEMORY DATABASE
// ==========================================

let foods = [
  { id: 1, name: "Sukuma Wiki", category: "Non-Starchy Veggie", carbs: 4, portion: "1 cup", image: "https://via.placeholder.com/150" },
  { id: 2, name: "Grilled Tilapia", category: "Lean Protein", carbs: 0, portion: "150g", image: "https://via.placeholder.com/150" },
  { id: 3, name: "Brown Rice", category: "Healthy Carb", carbs: 45, portion: "1/2 cup", image: "https://via.placeholder.com/150" }
];

let videos = [
  { id: 1, title: "Low Impact Walking", targetArea: "Full Body", duration: "15 mins", url: "https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4" },
  { id: 2, title: "Chair Exercises for Seniors", targetArea: "Joints & Legs", duration: "10 mins", url: "https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4" }
];

let glucoseLogs = [
  { id: 1, patientId: "P101", name: "Emmanuel M.", value: 5.8, unit: "mmol/L", context: "Fasting", timestamp: new Date().toISOString() }
];

let messages = [
  { id: 1, patientId: "P101", sender: "patient", text: "Hello Doctor, my morning reading was 5.8 mmol/L.", timestamp: "08:30 AM" },
  { id: 2, patientId: "P101", sender: "doctor", text: "Great job Emmanuel! Keep up with the non-starchy veggies today.", timestamp: "08:35 AM" }
];

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: "online", message: "Admet Server Running Successfully!" });
});

// 2. Diabetic Food Management (CRUD)
app.get('/api/foods', (req, res) => {
  res.json(foods);
});

app.post('/api/foods', (req, res) => {
  const newFood = { id: foods.length + 1, ...req.body };
  foods.push(newFood);
  res.status(201).json({ message: "Food added successfully", food: newFood });
});

app.delete('/api/foods/:id', (req, res) => {
  const foodId = parseInt(req.params.id);
  foods = foods.filter(f => f.id !== foodId);
  res.json({ message: "Food item deleted successfully" });
});

// 3. Exercise Video Management (Remote Sync Engine)
app.get('/api/videos', (req, res) => {
  res.json(videos);
});

app.post('/api/videos', (req, res) => {
  const newVideo = { id: videos.length + 1, ...req.body };
  videos.push(newVideo);
  res.status(201).json({ message: "Video uploaded successfully", video: newVideo });
});

app.delete('/api/videos/:id', (req, res) => {
  const videoId = parseInt(req.params.id);
  videos = videos.filter(v => v.id !== videoId);
  res.json({ message: "Video deleted. Patient devices will reconcile local storage.", deletedId: videoId });
});

// 4. Glucose Monitoring Logs
app.get('/api/glucose/:patientId', (req, res) => {
  const patientLogs = glucoseLogs.filter(g => g.patientId === req.params.patientId);
  res.json(patientLogs);
});

app.post('/api/glucose', (req, res) => {
  const newLog = { id: glucoseLogs.length + 1, timestamp: new Date().toISOString(), ...req.body };
  glucoseLogs.push(newLog);
  res.status(201).json({ message: "Glucose log saved", log: newLog });
});

// 5. Doctor-Patient Messaging
app.get('/api/messages/:patientId', (req, res) => {
  const patientMsgs = messages.filter(m => m.patientId === req.params.patientId);
  res.json(patientMsgs);
});

app.post('/api/messages', (req, res) => {
  const newMsg = { id: messages.length + 1, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ...req.body };
  messages.push(newMsg);
  res.status(201).json({ message: "Message sent", data: newMsg });
});

// Use port assigned by cloud host, or default to 5000 locally
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Admet Server running on port ${PORT}`);
});