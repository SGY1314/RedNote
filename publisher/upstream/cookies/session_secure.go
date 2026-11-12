// Workbench fork: Windows DPAPI protects persisted login credentials.
package cookies

import "os"

func readSession(path string) ([]byte, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	s, e := Unseal(string(b))
	return []byte(s), e
}
func writeSession(path string, data []byte) error {
	s, e := Seal(string(data))
	if e != nil {
		return e
	}
	return os.WriteFile(path, []byte(s), 0600)
}
