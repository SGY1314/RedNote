package app

import (
	"database/sql"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"strconv"
	"xhs-workbench/internal/domain"
)

type syncChange struct {
	Sequence int64           `json:"sequence"`
	Entity   string          `json:"entity"`
	ID       string          `json:"id"`
	Value    json.RawMessage `json:"value"`
}

// At most one journal entry per entity/id. Deletions retain a tombstone.
// Both the journal and its current values are read in one database snapshot.
func (a *App) syncChanges(c *gin.Context) {
	cursor, err := strconv.ParseInt(c.DefaultQuery("cursor", "0"), 10, 64)
	if err != nil || cursor < 0 {
		fail(c, 400, "同步游标无效")
		return
	}
	reset := c.Query("epoch") != a.SyncEpoch
	if reset {
		cursor = 0
	}
	changes := []syncChange{}
	more := false
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		resolver := taskProjectResolver{q: tx, cache: map[string][]byte{}}
		rows, e := tx.Query(`SELECT seq,entity,record_id FROM sync_changes WHERE seq>? ORDER BY seq LIMIT 201`, cursor)
		if e != nil {
			return e
		}
		for rows.Next() {
			var v syncChange
			if e = rows.Scan(&v.Sequence, &v.Entity, &v.ID); e != nil {
				rows.Close()
				return e
			}
			changes = append(changes, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if len(changes) > 200 {
			changes = changes[:200]
			more = true
		}
		var names map[string]domain.Asset
		for i := range changes {
			v := &changes[i]
			switch v.Entity {
			case "jobs", "assets", "projects", "publications":
			default:
				return nil
			}
			var raw string
			e = tx.QueryRow("SELECT data FROM "+v.Entity+" WHERE id=?", v.ID).Scan(&raw)
			if e == sql.ErrNoRows {
				v.Value = json.RawMessage("null")
			} else if e != nil {
				return e
			} else {
				v.Value = json.RawMessage(raw)
				if v.Entity == "assets" {
					if names == nil {
						names, e = assetPresentations(tx)
						if e != nil {
							return e
						}
					}
					v.Value, e = json.Marshal(names[v.ID])
					if e != nil {
						return e
					}
				}
				if v.Entity == "jobs" {
					var job domain.Job
					if err := json.Unmarshal(v.Value, &job); err != nil {
						return err
					}
					job.TaskProject = resolver.resolve(job)
					v.Value, e = json.Marshal(job)
					if e != nil {
						return e
					}
				}
			}
			cursor = v.Sequence
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "读取更新失败")
		return
	}
	c.JSON(200, gin.H{"changes": changes, "cursor": cursor, "epoch": a.SyncEpoch, "reset": reset, "more": more})
}
