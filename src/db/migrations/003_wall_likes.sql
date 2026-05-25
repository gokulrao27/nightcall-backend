CREATE TABLE IF NOT EXISTS wall_likes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     UUID NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_wall_likes_post ON wall_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_wall_likes_user ON wall_likes(user_id);

ALTER TABLE wall_posts
  ADD COLUMN IF NOT EXISTS type VARCHAR(20)
    NOT NULL DEFAULT 'confession'
    CHECK (type IN ('confession','letter','one_word','unfinished'));
