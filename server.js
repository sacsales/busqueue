const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());     
app.use(express.static('public'));


const db = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/busqueue' }); //connect to postgresql db
app.post('/api/times/:id/queue', async (req, res) => {
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
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
      `INSERT INTO queue_entries (route_time_id, position, phone)
       SELECT $1::int, COALESCE(MAX(position), 0) + 1, $2::text
       FROM queue_entries
       WHERE route_time_id = $1::int AND service_date = CURRENT_DATE
       RETURNING id, position`,
      [req.params.id, phone]
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


app.listen(process.env.PORT || 3000, () => console.log('Running'));

