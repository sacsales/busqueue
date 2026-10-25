const express = require('express');
const { Pool } = require('pg');

const crypto = require('crypto');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}


const app = express();
app.use(express.json());     
app.use(express.static('public'));


const db = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/busqueue' }); //connect to postgresql db

function cleanPhone(raw) {
  return String(raw || '').replace(/[^\d+]/g, '');
}


app.post('/api/times/:id/queue', async (req, res) => {
  const phone = cleanPhone(req.body.phone);

  if (!/^\+?\d{8,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Enter a valid phone number' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM route_times WHERE id = $1 FOR UPDATE', [req.params.id]);

    const existing = await client.query(
      `SELECT q.id, q.position, r.name AS route_name,
              to_char(t.depart_time, 'HH24:MI') AS depart_time
       FROM queue_entries q
       JOIN route_times t ON t.id = q.route_time_id
       JOIN routes r ON r.id = t.route_id
       WHERE q.phone = $1 AND q.service_date = CURRENT_DATE AND q.status = 'waiting'`,
      [phone]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already in line', ...existing.rows[0] });
    }

      const result = await client.query(
        `INSERT INTO queue_entries (route_time_id, position, phone, code)
        SELECT $1::int, COALESCE(MAX(position), 0) + 1, $2::text, $3::text
        FROM queue_entries
        WHERE route_time_id = $1::int AND service_date = CURRENT_DATE
        RETURNING id, position, code`,
        [req.params.id, phone, makeCode()]
      );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505' && e.constraint === 'one_active_line_per_phone') {
      return res.status(409).json({ error: 'Already in line' });
    }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});


app.get('/', (req, res) => {
  //res.send('Server is working');
});

app.get('/api/routes', async (req, res) => {
  const result = await db.query('SELECT id, name FROM routes ORDER BY name');
  res.json(result.rows); 
}); 

app.get('/api/routes/:id/times', async (req, res) => {
  const result = await db.query(
    `SELECT id, to_char(depart_time, 'HH24:MI') AS depart_time
     FROM route_times WHERE route_id = $1 ORDER BY depart_time`,
    [req.params.id]
  );
  res.json(result.rows);
});

app.post('/api/queue/mine', async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  const { rows } = await db.query(
    `SELECT q.position, q.code, r.name AS route_name,
            to_char(t.depart_time, 'HH24:MI') AS depart_time,
            (SELECT COUNT(*) FROM queue_entries o
             WHERE o.route_time_id = q.route_time_id
               AND o.service_date = q.service_date
               AND o.status = 'waiting'
               AND o.position < q.position)::int AS ahead,
               EXISTS (SELECT 1 FROM trip_alerts a
               WHERE a.route_time_id = q.route_time_id
               AND a.service_date = q.service_date) AS alerted
     FROM queue_entries q
     JOIN route_times t ON t.id = q.route_time_id
     JOIN routes r ON r.id = t.route_id
     WHERE q.phone = $1 AND q.service_date = CURRENT_DATE AND q.status = 'waiting'`,
    [phone]
  );
  res.json(rows[0] || null);
});

app.post('/api/queue/cancel', async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  const result = await db.query(
    `UPDATE queue_entries SET status = 'cancelled'
     WHERE phone = $1 AND service_date = CURRENT_DATE AND status = 'waiting'
     RETURNING id`,
    [phone]
  );
  res.json({ cancelled: result.rows.length > 0 });
});

app.post('/api/times/:id/approaching', async (req, res) => {
  const token = process.env.DRIVER_TOKEN;
  if (!token || req.get('x-driver-token') !== token) {
    return res.status(401).json({ error: 'Not allowed' });
  }

  try {
    await db.query(
      `INSERT INTO trip_alerts (route_time_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [req.params.id]
    );
    const waiting = await db.query(
      `SELECT COUNT(*)::int AS n FROM queue_entries
       WHERE route_time_id = $1 AND service_date = CURRENT_DATE AND status = 'waiting'`,
      [req.params.id]
    );
    res.json({ alerted: true, waiting: waiting.rows[0].n });
  } catch (e) {
    res.status(400).json({ error: 'Could not record the alert' });
  }
});

app.get('/api/trips', async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.id, r.name, to_char(t.depart_time, 'HH24:MI') AS depart_time
     FROM route_times t JOIN routes r ON r.id = t.route_id
     ORDER BY r.name, t.depart_time`
  );
  res.json(rows);
});


app.post('/api/attendant/lookup', async (req, res) => {
  const token = process.env.DRIVER_TOKEN;
  if (!token || req.get('x-driver-token') !== token) {
    return res.status(401).json({ error: 'Not allowed' });
  }

  const code = String(req.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  try {
    const { rows } = await db.query(
      `SELECT q.code, q.position, q.status,
              to_char(q.service_date, 'YYYY-MM-DD') AS service_date,
              (q.service_date = CURRENT_DATE) AS is_today,
              right(q.phone, 4) AS phone_last4,
              r.name AS route_name,
              to_char(t.depart_time, 'HH24:MI') AS depart_time,
              (SELECT COUNT(*) FROM queue_entries o
               WHERE o.route_time_id = q.route_time_id
                 AND o.service_date = q.service_date
                 AND o.status = 'waiting'
                 AND o.position < q.position)::int AS ahead
       FROM queue_entries q
       JOIN route_times t ON t.id = q.route_time_id
       JOIN routes r ON r.id = t.route_id
       WHERE q.code = $1`,
      [code]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No such code' });
    }
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});




app.listen(process.env.PORT || 3000, () => console.log('Running'));

