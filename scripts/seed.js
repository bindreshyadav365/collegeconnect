// Creates a few demo students so you can try the chat with several browser profiles.
// Usage: npm run seed      (all demo accounts use the password "Password123")
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../config');
const User = require('../models/User');

const students = [
  { name: 'Aarav Sharma', email: 'aarav@college.edu', branch: 'Computer Science', year: 3, bio: 'Building things at 2am' },
  { name: 'Diya Patel', email: 'diya@college.edu', branch: 'Electronics', year: 2, bio: 'Robotics club' },
  { name: 'Kabir Singh', email: 'kabir@college.edu', branch: 'Mechanical', year: 4, bio: 'Placement prep mode' },
  { name: 'Meera Nair', email: 'meera@college.edu', branch: 'Computer Science', year: 1, bio: 'New here, say hi!' },
];

(async () => {
  await mongoose.connect(config.mongoUri);
  const password = await bcrypt.hash('Password123', 12);
  for (const s of students) {
    const exists = await User.findOne({ email: s.email });
    if (exists) { console.log('exists ', s.email); continue; }
    await User.create({ ...s, college: 'Demo Institute of Technology', password });
    console.log('created', s.email);
  }
  await mongoose.disconnect();
  console.log('\nLog in with any of these emails and password: Password123');
})().catch((e) => { console.error(e); process.exit(1); });
