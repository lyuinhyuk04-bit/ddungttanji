const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  try {
    // 1. Read config.json
    const configPath = path.join(process.cwd(), 'config.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    // 2. Fetch schedules (Supabase or local file)
    let schedules = [];
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      // Fetch from Supabase
      const url = `${supabaseUrl}/rest/v1/schedules?select=*`;
      const response = await fetch(url, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`
        }
      });
      if (response.ok) {
        schedules = await response.json();
        // Sort schedules by date, member, time to match the expected format
        schedules.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          if (a.member !== b.member) return a.member.localeCompare(b.member);
          return (a.time || '').localeCompare(b.time || '');
        });
      } else {
        const errText = await response.text();
        console.error('Supabase fetch failed:', errText);
        // Fallback to local schedule.json
        schedules = readLocalSchedule();
      }
    } else {
      // Fallback to local schedule.json
      schedules = readLocalSchedule();
    }

    res.status(200).json({ config, schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function readLocalSchedule() {
  const schedulePath = path.join(process.cwd(), 'schedule.json');
  if (fs.existsSync(schedulePath)) {
    try {
      return JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
    } catch (e) {
      console.error('Failed to parse schedule.json:', e);
    }
  }
  return [];
}
