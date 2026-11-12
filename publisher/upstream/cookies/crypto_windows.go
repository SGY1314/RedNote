// Workbench fork: modified for local QR publishing (publisher/README.md).
//go:build windows

package cookies

import (
	"encoding/base64"
	"fmt"
	"syscall"
	"unsafe"
)

type blob struct {
	Size uint32
	Data *byte
}

var crypt = syscall.NewLazyDLL("crypt32.dll")
var kernel = syscall.NewLazyDLL("kernel32.dll")

func protect(input []byte, decrypt bool) ([]byte, error) {
	if len(input) == 0 {
		return nil, nil
	}
	in := blob{uint32(len(input)), &input[0]}
	var out blob
	name := "CryptProtectData"
	if decrypt {
		name = "CryptUnprotectData"
	}
	ok, _, err := crypt.NewProc(name).Call(uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, 1, uintptr(unsafe.Pointer(&out)))
	if ok == 0 {
		return nil, fmt.Errorf("Windows DPAPI 失败: %v", err)
	}
	defer kernel.NewProc("LocalFree").Call(uintptr(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}
func Seal(s string) (string, error) {
	b, e := protect([]byte(s), false)
	return base64.StdEncoding.EncodeToString(b), e
}
func Unseal(s string) (string, error) {
	b, e := base64.StdEncoding.DecodeString(s)
	if e != nil {
		return "", e
	}
	b, e = protect(b, true)
	return string(b), e
}
