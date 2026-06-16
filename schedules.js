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
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (configErr) {
        console.error('Failed to parse config.json:', configErr);
      }
    }

    // 2. Fetch schedules (Supabase or local file)
    let schedules = [];
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    // Log environment variables check (safe logging)
    console.log('=== SUPABASE ENV CHECK (api/schedules) ===');
    console.log('SUPABASE_URL exists:', !!supabaseUrl);
    if (supabaseUrl) {
      console.log('SUPABASE_URL value:', supabaseUrl);
    }
    console.log('SUPABASE_ANON_KEY exists:', !!supabaseAnonKey);
    if (supabaseAnonKey) {
      console.log('SUPABASE_ANON_KEY length:', supabaseAnonKey.length);
      const sanitizedKey = supabaseAnonKey.replace(/[\r\n]/g, '\\n');
      console.log('SUPABASE_ANON_KEY starts with:', sanitizedKey.substring(0, 15) + '...');
    }
    console.log('==========================================');

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
        const data = await response.json();
        if (Array.isArray(data)) {
          schedules = data;
          // Safe sort schedules by date, member, time to prevent null localeCompare TypeError
          schedules.sort((a, b) => {
            const dateA = a.date || '';
            const dateB = b.date || '';
            if (dateA !== dateB) return dateA.localeCompare(dateB);

            const memberA = a.member || '';
            const memberB = b.member || '';
            if (memberA !== memberB) return memberA.localeCompare(memberB);

            const timeA = a.time || '';
            const timeB = b.time || '';
            return timeA.localeCompare(timeB);
          });
        } else {
          console.error('Supabase response is not an array:', data);
          schedules = readLocalSchedule();
        }
      } else {
        const errText = await response.text();
        console.error('Supabase fetch failed:', errText);
        // Fallback to local schedule.json
        schedules = readLocalSchedule();
      }
    } else {
      console.warn('Supabase env vars missing, falling back to local schedule.json');
      // Fallback to local schedule.json
      schedules = readLocalSchedule();
    }

    res.status(200).json({ config, schedules });
  } catch (err) {
    console.error('API Handler Exception:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
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
