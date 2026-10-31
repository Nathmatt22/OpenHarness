package io.openharness.mobile.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

/** Local SQLite store. Same schema as the desktop build (minus better-sqlite3). */
class HarnessDb(context: Context) : SQLiteOpenHelper(context, "openharness.sqlite", null, 2) {

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,name TEXT,type TEXT,base_url TEXT,model TEXT,secret TEXT,created_at TEXT)")
        db.execSQL("CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT,description TEXT,instructions TEXT,icon TEXT,tools TEXT,custom INTEGER DEFAULT 0)")
        db.execSQL("CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT,agent_id TEXT,connection_id TEXT,created_at TEXT)")
        db.execSQL("CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,created_at TEXT)")
        db.execSQL("CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT,agent_ids TEXT,folders TEXT,created_at TEXT)")
        db.execSQL("CREATE TABLE IF NOT EXISTS missions(id TEXT PRIMARY KEY,team_id TEXT,title TEXT,status TEXT,result TEXT,created_at TEXT)")
        db.execSQL("CREATE TABLE IF NOT EXISTS mission_events(id TEXT PRIMARY KEY,mission_id TEXT,agent_id TEXT,content TEXT,created_at TEXT)")
        db.execSQL("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT)")
        seedAgents(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            val teams = db.rawQuery("pragma table_info(teams)", null)
            var hasFolders = false
            while (teams.moveToNext()) if (teams.getString(teams.getColumnIndexOrThrow("name")) == "folders") hasFolders = true
            teams.close()
            if (!hasFolders) db.execSQL("ALTER TABLE teams ADD COLUMN folders TEXT")
        }
        seedAgents(db)
    }

    private fun seedAgents(db: SQLiteDatabase) {
        for (a in BUILT_IN_AGENTS) {
            db.execSQL(
                "INSERT OR IGNORE INTO agents(id,name,description,instructions,icon,tools,custom) VALUES(?,?,?,?,?,?,0)",
                arrayOf(a.id, a.name, a.description, a.instructions, a.icon, a.tools.joinToString(",") { "\"$it\"" })
            )
        }
    }

    private fun now() = java.time.Instant.now().toString()

    private fun jsonArrayOf(values: List<String>): String {
        val array = org.json.JSONArray()
        values.forEach { array.put(it) }
        return array.toString()
    }

    fun appData(): AppData {
        val db = readableDatabase
        return AppData(
            agents = query(db, "SELECT * FROM agents ORDER BY custom,name") { c ->
                Agent(
                    c.getString(c.getColumnIndexOrThrow("id")),
                    c.getString(c.getColumnIndexOrThrow("name")),
                    c.getString(c.getColumnIndexOrThrow("description")) ?: "",
                    c.getString(c.getColumnIndexOrThrow("instructions")) ?: "",
                    c.getString(c.getColumnIndexOrThrow("icon")) ?: "sparkles",
                    c.getString(c.getColumnIndexOrThrow("tools")) ?: "[]",
                    c.getInt(c.getColumnIndexOrThrow("custom"))
                )
            },
            connections = query(db, "SELECT id,name,type,base_url,model,created_at FROM connections ORDER BY created_at") { c ->
                Connection(
                    c.getString(0), c.getString(1), c.getString(2),
                    c.getString(3) ?: "", c.getString(4) ?: "", c.getString(5) ?: ""
                )
            },
            conversations = query(db, "SELECT id,title,agent_id,connection_id,created_at FROM conversations ORDER BY created_at DESC") { c ->
                Conversation(c.getString(0), c.getString(1) ?: "", c.getString(2), c.getString(3), c.getString(4) ?: "")
            },
            teams = query(db, "SELECT id,name,agent_ids,folders,created_at FROM teams ORDER BY created_at DESC") { c ->
                Team(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: "[]", c.getString(3), c.getString(4) ?: "")
            },
            settings = query(db, "SELECT key,value FROM settings") { c -> c.getString(0) to (c.getString(1) ?: "") }.toMap(),
            encryptionAvailable = true
        )
    }

    private fun <T> query(db: SQLiteDatabase, sql: String, map: (android.database.Cursor) -> T): List<T> {
        val cursor = db.rawQuery(sql, null)
        val out = ArrayList<T>()
        cursor.use { while (it.moveToNext()) out.add(map(it)) }
        return out
    }

    fun agent(id: String): Agent? = query(readableDatabase, "SELECT * FROM agents WHERE id='${id.replace("'", "''")}'") { c ->
        Agent(c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5), c.getInt(6))
    }.firstOrNull()

    fun setting(key: String): String? =
        query(readableDatabase, "SELECT value FROM settings WHERE key='${key.replace("'", "''")}'") { it.getString(0) }.firstOrNull()

    fun setSetting(key: String, value: String) {
        val db = writableDatabase
        val updated = db.compileStatement("UPDATE settings SET value=? WHERE key=?").let {
            it.bindString(1, value); it.bindString(2, key); it.executeUpdateDelete()
        }
        if (updated == 0) db.execSQL("INSERT INTO settings(key,value) VALUES(?,?)", arrayOf(key, value))
    }

    fun connectionSecret(id: String): String? =
        query(readableDatabase, "SELECT secret FROM connections WHERE id='${id.replace("'", "''")}'") { it.getString(0) }.firstOrNull()

    fun connection(id: String): Connection? =
        query(readableDatabase, "SELECT id,name,type,base_url,model,created_at FROM connections WHERE id='${id.replace("'", "''")}'") { c ->
            Connection(c.getString(0), c.getString(1), c.getString(2), c.getString(3) ?: "", c.getString(4) ?: "", c.getString(5) ?: "")
        }.firstOrNull()

    fun firstConnectionId(): String? =
        query(readableDatabase, "SELECT id FROM connections ORDER BY created_at LIMIT 1") { it.getString(0) }.firstOrNull()

    fun saveConnection(name: String, type: String, baseUrl: String, model: String, secret: String, id: String? = null): String {
        val key = id ?: UUID.randomUUID().toString()
        val db = writableDatabase
        val values = ContentValues().apply {
            put("name", name)
            put("type", type)
            put("base_url", baseUrl)
            put("model", model)
        }
        val existing = query(db, "SELECT secret FROM connections WHERE id='${key.replace("'", "''")}'") { it.getString(0) }
            .firstOrNull()
        when {
            existing == null -> {
                values.put("id", key)
                values.put("secret", secret)
                values.put("created_at", now())
                db.insertWithOnConflict("connections", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            }
            else -> {
                if (secret.isNotEmpty()) values.put("secret", secret)
                db.update("connections", values, "id=?", arrayOf(key))
            }
        }
        return key
    }

    fun deleteConnection(id: String) {
        writableDatabase.delete("connections", "id=?", arrayOf(id))
    }

    fun createConversation(agentId: String, connectionId: String?, title: String): String {
        val id = UUID.randomUUID().toString()
        writableDatabase.execSQL(
            "INSERT INTO conversations(id,title,agent_id,connection_id,created_at) VALUES(?,?,?,?,?)",
            arrayOf(id, title, agentId, connectionId, now())
        )
        return id
    }

    fun renameConversation(id: String, title: String) {
        writableDatabase.execSQL("UPDATE conversations SET title=? WHERE id=?", arrayOf(title, id))
    }

    fun deleteConversation(id: String) {
        val db = writableDatabase
        db.delete("messages", "conversation_id=?", arrayOf(id))
        db.delete("conversations", "id=?", arrayOf(id))
    }

    fun messages(conversationId: String): List<ChatMessage> =
        query(readableDatabase, "SELECT id,role,content FROM messages WHERE conversation_id='${conversationId.replace("'", "''")}' ORDER BY created_at") { c ->
            ChatMessage(c.getString(0), c.getString(1), c.getString(2))
        }

    fun saveMessage(conversationId: String, role: String, content: String) {
        writableDatabase.execSQL(
            "INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)",
            arrayOf(UUID.randomUUID().toString(), conversationId, role, content, now())
        )
    }

    fun saveAgent(name: String, description: String, instructions: String, icon: String, id: String? = null): String {
        val key = id ?: UUID.randomUUID().toString()
        val db = writableDatabase
        val existing = query(db, "SELECT id FROM agents WHERE id='${key.replace("'", "''")}' AND custom=1") { it.getString(0) }
            .firstOrNull()
        val values = ContentValues().apply {
            put("name", name)
            put("description", description)
            put("instructions", instructions)
            put("icon", icon)
            put("tools", "[]")
            put("custom", 1)
        }
        if (existing == null) {
            values.put("id", key)
            db.insertWithOnConflict("agents", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        } else {
            db.update("agents", values, "id=?", arrayOf(key))
        }
        return key
    }

    fun deleteCustomAgent(id: String) {
        writableDatabase.delete("agents", "id=? AND custom=1", arrayOf(id))
    }

    fun saveTeam(name: String, agentIds: List<String>, folders: List<String>, id: String? = null): String {
        val key = id ?: UUID.randomUUID().toString()
        val ids = jsonArrayOf(agentIds)
        val dirs = jsonArrayOf(folders)
        val db = writableDatabase
        val existing = query(db, "SELECT id FROM teams WHERE id='${key.replace("'", "''")}'") { it.getString(0) }.firstOrNull()
        val values = ContentValues().apply {
            put("name", name)
            put("agent_ids", ids)
            put("folders", dirs)
        }
        if (existing == null) {
            values.put("id", key)
            values.put("created_at", now())
            db.insertWithOnConflict("teams", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        } else {
            db.update("teams", values, "id=?", arrayOf(key))
        }
        return key
    }

    fun deleteTeam(id: String) {
        val db = writableDatabase
        db.execSQL("DELETE FROM mission_events WHERE mission_id IN (SELECT id FROM missions WHERE team_id=?)", arrayOf(id))
        db.delete("missions", "team_id=?", arrayOf(id))
        db.delete("teams", "id=?", arrayOf(id))
    }

    fun team(id: String): Team? =
        query(readableDatabase, "SELECT id,name,agent_ids,folders,created_at FROM teams WHERE id='${id.replace("'", "''")}'") { c ->
            Team(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: "[]", c.getString(3), c.getString(4) ?: "")
        }.firstOrNull()

    fun startMission(teamId: String, title: String): String {
        val id = UUID.randomUUID().toString()
        writableDatabase.execSQL(
            "INSERT INTO missions(id,team_id,title,status,result,created_at) VALUES(?,?,?,?,?,?)",
            arrayOf(id, teamId, title, "running", "", now())
        )
        return id
    }

    fun recordEvent(missionId: String, agentId: String, content: String) {
        writableDatabase.insertWithOnConflict(
            "mission_events", null,
            ContentValues().apply {
                put("id", UUID.randomUUID().toString())
                put("mission_id", missionId)
                put("agent_id", agentId)
                put("content", content)
                put("created_at", now())
            },
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    fun finishMission(id: String, status: String, result: String) {
        writableDatabase.execSQL(
            "UPDATE missions SET status=?,result=? WHERE id=?",
            arrayOf(status, result, id)
        )
    }

    fun missionEvents(missionId: String): List<MissionEvent> =
        query(readableDatabase, "SELECT mission_id,agent_id,content FROM mission_events WHERE mission_id='${missionId.replace("'", "''")}' ORDER BY created_at") { c ->
            MissionEvent(c.getString(0), c.getString(1), c.getString(2))
        }
}
