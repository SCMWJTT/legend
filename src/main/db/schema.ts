// Library database structure. Each entry upgrades the library by one version.
// Rules: never edit a released migration; only append new ones. Migrations only add
// tables, columns or indexes so older data is always carried forward.

export const MIGRATIONS: string[] = [
  // ---- version 1 ----
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE photos (
    id INTEGER PRIMARY KEY,
    raw_key TEXT NOT NULL COLLATE NOCASE,
    variant_no INTEGER NOT NULL DEFAULT 0,
    legend_id TEXT UNIQUE,
    published_name TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    title TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    alt TEXT NOT NULL DEFAULT '',
    rating INTEGER NOT NULL DEFAULT 0,
    creator TEXT NOT NULL DEFAULT '',
    copyright TEXT NOT NULL DEFAULT '',
    licence TEXT NOT NULL DEFAULT '',
    credit TEXT NOT NULL DEFAULT '',
    shoot_id INTEGER REFERENCES shoots(id),
    subgroup_id INTEGER REFERENCES subgroups(id),
    lat REAL, lon REAL, elevation REAL,
    cam_lat REAL, cam_lon REAL, cam_ele REAL,
    pos_source TEXT NOT NULL DEFAULT 'none',
    show_elevation INTEGER NOT NULL DEFAULT 0,
    precision TEXT NOT NULL DEFAULT 'rounded',
    no_location INTEGER NOT NULL DEFAULT 0,
    people INTEGER NOT NULL DEFAULT 0,
    private_place INTEGER NOT NULL DEFAULT 0,
    captured TEXT,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    camera_body TEXT NOT NULL DEFAULT '',
    lens TEXT NOT NULL DEFAULT '',
    focal REAL, aperture REAL,
    shutter TEXT NOT NULL DEFAULT '',
    iso INTEGER,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    file_mtime REAL NOT NULL DEFAULT 0,
    file_hash TEXT NOT NULL DEFAULT '',
    file_offline INTEGER NOT NULL DEFAULT 0,
    thumb_ver INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    exported_at TEXT,
    retired INTEGER NOT NULL DEFAULT 0,
    UNIQUE (raw_key, variant_no)
  );
  CREATE INDEX photos_shoot ON photos(shoot_id);
  CREATE INDEX photos_captured ON photos(captured);

  CREATE TABLE shoots (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_photo_id INTEGER,
    time_zone TEXT NOT NULL DEFAULT '',
    clock_offset_min INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    next_number INTEGER NOT NULL DEFAULT 1,
    retired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE subgroups (
    id INTEGER PRIMARY KEY,
    shoot_id INTEGER NOT NULL REFERENCES shoots(id),
    heading TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_photo_id INTEGER,
    anchor_lat REAL, anchor_lon REAL,
    anchor_set INTEGER NOT NULL DEFAULT 0,
    featured TEXT NOT NULL DEFAULT '[]',
    writeup TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0
  );

  -- Every Legend ID ever issued. Rows are never deleted.
  CREATE TABLE id_registry (
    legend_id TEXT PRIMARY KEY,
    shoot_code TEXT NOT NULL,
    number INTEGER NOT NULL,
    photo_id INTEGER,
    raw_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',   -- active | retired
    issued_at TEXT NOT NULL,
    retired_at TEXT
  );

  CREATE TABLE name_history (
    id INTEGER PRIMARY KEY,
    photo_id INTEGER NOT NULL,
    old_name TEXT NOT NULL,
    new_name TEXT NOT NULL,
    at TEXT NOT NULL
  );

  CREATE TABLE hierarchies (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    multi INTEGER NOT NULL DEFAULT 1,
    levels TEXT NOT NULL DEFAULT '[]',
    has_position INTEGER NOT NULL DEFAULT 0,
    required INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    alphabetical INTEGER NOT NULL DEFAULT 1,
    id_prefix TEXT NOT NULL,
    next_public INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE nodes (
    id INTEGER PRIMARY KEY,
    hierarchy_id INTEGER NOT NULL REFERENCES hierarchies(id),
    parent_id INTEGER REFERENCES nodes(id),
    public_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    alt_names TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    cover_photo_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    refs TEXT NOT NULL DEFAULT '{}',
    lat REAL, lon REAL, zoom INTEGER,
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX nodes_parent ON nodes(parent_id);
  CREATE INDEX nodes_hier ON nodes(hierarchy_id);

  -- Derived ancestor table: rebuilt from nodes.parent_id whenever the tree changes.
  CREATE TABLE node_closure (
    ancestor INTEGER NOT NULL,
    descendant INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    PRIMARY KEY (ancestor, descendant)
  );
  CREATE INDEX closure_desc ON node_closure(descendant);

  CREATE TABLE photo_nodes (
    id INTEGER PRIMARY KEY,
    photo_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    UNIQUE (photo_id, node_id)
  );
  CREATE INDEX photo_nodes_node ON photo_nodes(node_id);

  CREATE TABLE sets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE set_members (
    id INTEGER PRIMARY KEY,
    set_id INTEGER NOT NULL,
    photo_id INTEGER NOT NULL,
    UNIQUE (set_id, photo_id)
  );
  CREATE INDEX set_members_photo ON set_members(photo_id);

  CREATE TABLE sites (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    export_folder TEXT NOT NULL DEFAULT '',
    decimals INTEGER NOT NULL DEFAULT 3,
    hierarchies TEXT NOT NULL DEFAULT '[]',
    retired INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE photo_sites (
    id INTEGER PRIMARY KEY,
    photo_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'selected',
    published_at TEXT,
    UNIQUE (photo_id, site_id)
  );

  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    folder TEXT NOT NULL,
    scanned INTEGER NOT NULL, added INTEGER NOT NULL, known INTEGER NOT NULL,
    changed INTEGER NOT NULL, variants INTEGER NOT NULL, skipped INTEGER NOT NULL,
    set_id INTEGER,
    report TEXT NOT NULL
  );

  CREATE TABLE exports (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    site_id INTEGER NOT NULL,
    report TEXT NOT NULL
  );

  -- One row per user action (one undo step).
  CREATE TABLE actions (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    label TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  );
  -- Every change made by an action. Used for undo/redo and for field history.
  CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL,
    op TEXT NOT NULL,          -- set | insert | delete
    tbl TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    photo_id INTEGER,          -- the photo this change concerns, when there is one
    field TEXT,
    old_value TEXT,
    new_value TEXT
  );
  CREATE INDEX changes_row ON changes(tbl, row_id);
  CREATE INDEX changes_photo ON changes(photo_id);
  CREATE INDEX changes_action ON changes(action_id);
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length
