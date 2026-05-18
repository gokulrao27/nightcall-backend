-- OTP verifications
CREATE TABLE IF NOT EXISTS verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  contact     VARCHAR(255) NOT NULL,
  type        VARCHAR(10)  NOT NULL CHECK (type IN ('phone','email')),
  code        VARCHAR(6)   NOT NULL,
  attempts    INTEGER      NOT NULL DEFAULT 0,
  verified    BOOLEAN      NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_verif_contact ON verifications(contact, type);

-- Confessions
CREATE TABLE IF NOT EXISTS confessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL CHECK (char_length(answer) <= 140),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, call_id)
);
CREATE INDEX IF NOT EXISTS idx_confessions_call ON confessions(call_id);

-- Streak + badge tracking on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS streak             INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_last_called DATE,
  ADD COLUMN IF NOT EXISTS streak_freezes     INTEGER     NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS badges             TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS phone              VARCHAR(20),
  ADD COLUMN IF NOT EXISTS phone_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

-- Country info on calls
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS country_a  VARCHAR(80),
  ADD COLUMN IF NOT EXISTS country_b  VARCHAR(80),
  ADD COLUMN IF NOT EXISTS city_a     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city_b     VARCHAR(100);

-- Nightly stats cache
CREATE TABLE IF NOT EXISTS nightly_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date         DATE NOT NULL UNIQUE,
  total_calls       INTEGER NOT NULL DEFAULT 0,
  most_common_word  VARCHAR(30),
  city_a            VARCHAR(100),
  city_b            VARCHAR(100),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
