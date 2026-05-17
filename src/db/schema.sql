CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_tier AS ENUM ('free', 'premium');

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym       VARCHAR(30) NOT NULL,
  avatar          VARCHAR(30) NOT NULL DEFAULT 'moon',
  timezone        VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',
  tier            user_tier NOT NULL DEFAULT 'free',
  email           VARCHAR(255),
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  ban_expires_at  TIMESTAMPTZ,
  consent_age     BOOLEAN NOT NULL DEFAULT FALSE,
  consent_anon    BOOLEAN NOT NULL DEFAULT FALSE,
  consent_terms   BOOLEAN NOT NULL DEFAULT FALSE,
  consented_at    TIMESTAMPTZ,
  push_endpoint   TEXT,
  push_keys       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id         VARCHAR(64) NOT NULL UNIQUE,
  prompt_id       INTEGER,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_secs   INTEGER,
  ended_by        VARCHAR(10) CHECK (ended_by IN ('timer','user_a','user_b','system'))
);

CREATE TABLE words (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  word            VARCHAR(30) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wall_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  body            TEXT NOT NULL CHECK (char_length(body) <= 500),
  country_vague   VARCHAR(80),
  is_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
  is_approved     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  reason          TEXT,
  reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id  VARCHAR(255) UNIQUE,
  stripe_sub_id       VARCHAR(255) UNIQUE,
  tier                user_tier NOT NULL DEFAULT 'premium',
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ
);

CREATE TABLE conversation_prompts (
  id      SERIAL PRIMARY KEY,
  body    TEXT NOT NULL,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Indexes
CREATE INDEX idx_calls_user_a ON calls(user_a);
CREATE INDEX idx_calls_user_b ON calls(user_b);
CREATE INDEX idx_calls_started ON calls(started_at DESC);
CREATE INDEX idx_wall_created ON wall_posts(created_at DESC) WHERE is_approved = TRUE;
CREATE INDEX idx_words_user ON words(user_id, created_at DESC);
CREATE INDEX idx_reports_reported ON reports(reported_id, reviewed);

-- Seed conversation prompts
INSERT INTO conversation_prompts (body) VALUES
  ('What''s something you''ve been carrying alone that you wish someone knew?'),
  ('What would you do differently if no one was watching?'),
  ('What''s something you almost did but talked yourself out of?'),
  ('When did you last feel completely free?'),
  ('What''s the thing you''re most afraid to admit you want?'),
  ('What are you pretending is fine when it isn''t?'),
  ('What would you tell the version of you from 5 years ago?'),
  ('What does your life sound like at 3AM when you''re honest?'),
  ('Who do you miss that you''ll never tell?'),
  ('What''s the story you keep rewriting in your head?');
