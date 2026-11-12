package workflow

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

func DigestValue(value any) string {
	b, _ := json.Marshal(value)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
