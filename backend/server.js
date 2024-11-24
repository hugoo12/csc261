const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Static JWT Secret Key
const JWT_SECRET = 'simpleSecretKey';

// Database connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '50121251991Vi',
  database: 'student_attendance_db',
});

db.connect((err) => {
  if (err) throw err;
  console.log('Database connected!');
});

// Generate session code
function generateSessionCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase(); // Short alphanumeric code
}

// Authentication middleware (simplified)
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// --- Endpoints ---

// Login
app.post('/api/login', (req, res) => {
  const { role, id, password } = req.body;

  let tableName = role === 'student' ? 'Students' : 'Faculty';
  let idColumn = role === 'student' ? 'Student_Id' : 'Faculty_Id';

  const query = `SELECT * FROM ${tableName} WHERE ${idColumn} = ? AND Passcode = ?`;

  db.query(query, [id, password], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid ID or password' });
    }

    const token = jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({
      success: true,
      message: 'Login successful!',
      token,
      role,
    });
  });
});

// Create session code (Faculty)
app.post('/create-session', authenticate, (req, res) => {
  const { courseId } = req.body;
  const sessionCode = generateSessionCode();
  const now = new Date();
  const expirationTime = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
  const status = 'active';

  const query = `
    INSERT INTO Attendance_Codes (Generated_Code, Session_Date, Expiration_Time, Status, Course_Id)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.query(
    query,
    [sessionCode, now.toISOString().slice(0, 10), expirationTime.toISOString().slice(11, 19), status, courseId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to create session code' });
      res.json({ sessionCode, expiresAt: expirationTime });
    }
  );
});

// Mark attendance (Student)
app.post('/mark-attendance', authenticate, (req, res) => {
  const { sessionCode } = req.body;
  const studentId = req.user.id;

  const validateQuery = `
    SELECT * FROM Attendance_Codes WHERE Generated_Code = ? AND Expiration_Time > NOW()
  `;
  db.query(validateQuery, [sessionCode], (err, results) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    if (results.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired session code' });
    }

    const attendanceQuery = `
      INSERT INTO Attendance (Attendance_Date, Status, Student_Id)
      VALUES (NOW(), 'present', ?)
    `;
    db.query(attendanceQuery, [studentId], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to mark attendance' });
      res.json({ message: 'Attendance marked successfully' });
    });
  });
});

// Get student attendance
app.get('/api/student/attendance', authenticate, (req, res) => {
  const studentId = req.user.id;

  const query = `
    SELECT A.Attendance_Date AS date, A.Status AS status, C.Course_Name AS courseName
    FROM Attendance A
    JOIN Attendance_Codes AC ON A.Student_Id = ?
    JOIN Courses C ON AC.Course_Id = C.Course_Id
  `;
  db.query(query, [studentId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch attendance records' });
    res.json({ records: results });
  });
});

// Get faculty attendance
app.get('/api/faculty/attendance', authenticate, (req, res) => {
  const facultyId = req.user.id;

  const query = `
    SELECT A.Attendance_Date AS date, S.First_Name AS studentName, C.Course_Name AS courseName, A.Status AS status
    FROM Attendance A
    JOIN Students S ON A.Student_Id = S.Student_Id
    JOIN Attendance_Codes AC ON AC.Course_Id IN (
      SELECT Course_Id FROM Courses WHERE Faculty_Id = ?
    )
    JOIN Courses C ON AC.Course_Id = C.Course_Id
  `;
  db.query(query, [facultyId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch attendance records' });
    res.json({ records: results });
  });
});

const PORT = 4000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
