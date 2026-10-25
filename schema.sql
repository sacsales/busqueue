CREATE TABLE routes (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE route_times (
  id          SERIAL PRIMARY KEY,
  route_id    INT NOT NULL REFERENCES routes(id),
  depart_time TIME NOT NULL
);

CREATE TABLE queue_entries (
  id            SERIAL PRIMARY KEY,
  route_time_id INT NOT NULL REFERENCES route_times(id),
  service_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  position      INT NOT NULL,
  phone         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'boarded', 'cancelled')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_time_id, service_date, position)
);

CREATE UNIQUE INDEX one_active_line_per_phone
  ON queue_entries (phone, service_date) WHERE status = 'waiting';



INSERT INTO routes (name) VALUES
  ('One Ayala->Nuvali'),
  ('Circuit Makati->UP Town Centre');

INSERT INTO route_times (route_id, depart_time) VALUES
  (1, '08:00'),
  (1, '12:30'),
  (2, '06:45'),
  (2, '08:20');


CREATE TABLE trip_alerts (
  route_time_id INT NOT NULL REFERENCES route_times(id),
  service_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  alerted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (route_time_id, service_date)
);

