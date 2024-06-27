const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = 5000;

const corsOptions = {
  origin: 'https://split-money-three.vercel.app',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: 'Content-Type,Authorization',
  credentials: true
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const distributionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  friends: { type: String, required: true },
  spender: { type: String, required: true },
  description: { type: String, required: true },
  distribution: { type: Map, of: String, required: true }
});

const User = mongoose.model('User', userSchema);
const Distribution = mongoose.model('Distribution', distributionSchema);

app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 8);
    
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    
    res.status(200).send('User registered successfully');
  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).send('Server error');
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) return res.status(404).send('User not found');
    
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) return res.status(401).send('Invalid password');
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: 86400 });
    
    res.status(200).send({ auth: true, token });
  } catch (err) {
    console.error('Error logging in:', err);
    res.status(500).send('Server error');
  }
});

app.post('/distribution', async (req, res) => {
  try {
    const { user_id, amount, friends, spender, description, distribution } = req.body;
    
    const newDistribution = new Distribution({
      user_id,
      amount,
      friends,
      spender,
      description,
      distribution
    });
    
    await newDistribution.save();
    res.status(200).send('Distribution saved successfully');
  } catch (err) {
    console.error('Error saving distribution:', err);
    res.status(500).send('Failed to save distribution');
  }
});

app.get('/distributions/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const distributions = await Distribution.find({ user_id: userId });
    res.status(200).json(distributions);
  } catch (err) {
    console.error('Error fetching distributions:', err);
    res.status(500).send('Failed to fetch distributions');
  }
});

app.post('/send-distribution-email', async (req, res) => {
  const { friends, friendEmails, distribution } = req.body;

  if (!friends || !friendEmails || !distribution) {
    return res.status(400).json({ error: 'Missing required data.' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
    }
  });

  const createContent = (friend, distributionData) => {
    let content = `Friend Money Distribution\n`;
    content += `Friend: ${friend}\n`;

    for (const [spender, payments] of Object.entries(distributionData)) {
      content += `Spender: ${spender}\n`;
      let totalDue = 0;
      payments.forEach(payment => {
        content += `${spender} paid for ${payment.description}: ${payment.amount.toFixed(2)} (${payment.paid ? 'Paid' : 'Due'})\n`;
        if (!payment.paid) {
          totalDue += payment.amount;
        }
      });
      content += `Total amount due by ${spender}: ${totalDue.toFixed(2)}\n`;
    }

    return content;
  };

  const createPDF = (content) => {
    return new Promise((resolve) => {
      const doc = new PDFDocument();
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.text(content);
      doc.end();
    });
  };

  const sendEmail = async (friend, email, distributionData) => {
    const content = createContent(friend, distributionData);
    const pdfBuffer = await createPDF(content);

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: `Money Distribution Details for ${friend}`,
      text: content,
      attachments: [{
        filename: 'distribution_details.pdf',
        content: pdfBuffer
      }]
    };

    return transporter.sendMail(mailOptions);
  };

  try {
    const emailPromises = friends.map((friend, index) =>
      sendEmail(friend, friendEmails[index], distribution[friend])
    );

    await Promise.all(emailPromises);

    res.status(200).json({ message: 'Emails sent successfully.' });
  } catch (error) {
    console.error('Failed to send emails:', error);
    res.status(500).json({ error: 'Failed to send emails.' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
