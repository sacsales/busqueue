const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.static('public'));


const db = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/busqueue' }); //connect to postgresql db


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

