const express = require('express');
const { Pool } = require('pg');

const app = express();
const db = new Pool({ connectionString: 'postgres://localhost:5432/busqueue' });

app.get('/', (req, res) => {
  res.send('Server is working');
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


app.listen(3000, () => console.log('Running on http://localhost:3000'));

