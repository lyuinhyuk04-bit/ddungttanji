const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  try {
    let events = [];
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      // Fetch from Supabase events table
      const url = `${supabaseUrl}/rest/v1/events?select=*`;
      const response = await fetch(url, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          events = data;
        } else {
          console.error('Supabase response is not an array:', data);
          events = readLocalEvents();
        }
      } else {
        const errText = await response.text();
        console.error('Supabase fetch events failed:', errText);
        events = readLocalEvents();
      }
    } else {
      events = readLocalEvents();
    }

    res.status(200).json(events);
  } catch (err) {
    console.error('API Events Handler Exception:', err);
    res.status(500).json({ error: err.message });
  }
};

function readLocalEvents() {
  const eventsPath = path.join(process.cwd(), 'events.json');
  if (fs.existsSync(eventsPath)) {
    try {
      return JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    } catch (e) {
      console.error('Failed to parse events.json:', e);
    }
  }
  return [];
}
