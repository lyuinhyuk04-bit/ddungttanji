const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  }

  try {
    let newEvents = req.body;
    if (typeof newEvents === 'string') {
      try {
        newEvents = JSON.parse(newEvents);
      } catch (e) {
        return res.status(400).json({ status: 'error', message: 'Invalid JSON body' });
      }
    }

    if (!newEvents || !Array.isArray(newEvents)) {
      return res.status(400).json({ status: 'error', message: 'Invalid events data structure' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      // 1. Clear Supabase events table
      const deleteUrl = `${supabaseUrl}/rest/v1/events?id=not.is.null`;
      const deleteResp = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`
        }
      });
      if (!deleteResp.ok) {
        const deleteErr = await deleteResp.text();
        return res.status(500).json({ status: 'error', message: `Supabase clear failed: ${deleteErr}` });
      }

      // 2. Insert new records in bulk
      const payload = newEvents.map(e => ({
        title: e.title || '',
        start_date: e.start_date || '',
        end_date: e.end_date || '',
        description: e.description || '',
        link: e.link || '',
        image: e.image || ''
      }));

      if (payload.length > 0) {
        const insertUrl = `${supabaseUrl}/rest/v1/events`;
        const insertResp = await fetch(insertUrl, {
          method: 'POST',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (!insertResp.ok) {
          const insertErr = await insertResp.text();
          return res.status(500).json({ status: 'error', message: `Supabase insert failed: ${insertErr}` });
        }
      }
    } else {
      // Fallback: Write local events.json file
      try {
        const eventsPath = path.join(process.cwd(), 'events.json');
        fs.writeFileSync(eventsPath, JSON.stringify(newEvents, null, 2), 'utf8');
      } catch (writeErr) {
        console.error('Failed to write local events.json:', writeErr);
        return res.status(500).json({ status: 'error', message: 'Failed to save locally in read-only environment' });
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};
