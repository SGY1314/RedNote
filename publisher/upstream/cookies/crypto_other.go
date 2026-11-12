//go:build !windows

package cookies

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"strings"
)

// Linux deployments provide a separate 32-byte, owner-only master key.
// It must be backed up with the database and must never be regenerated on restart.
func secretCipher() (cipher.AEAD, error) {
	path := os.Getenv("WORKBENCH_KEY_FILE")
	if path == "" {
		return nil, errors.New("请配置服务器密钥文件 WORKBENCH_KEY_FILE")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("服务器密钥文件不存在或权限不安全（需 0600）")
	}
	key, err := os.ReadFile(path)
	if err != nil || len(key) != 32 {
		return nil, errors.New("服务器密钥文件无效，需 32 字节")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func Seal(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	box, err := secretCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, box.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	encrypted := box.Seal(nonce, nonce, []byte(s), []byte("workbench-secret-v1"))
	return "aesgcm:v1:" + base64.StdEncoding.EncodeToString(encrypted), nil
}
func Unseal(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	if !strings.HasPrefix(s, "aesgcm:v1:") {
		return "", errors.New("不支持该密钥格式；Windows 密钥和登录状态需在服务器重新配置")
	}
	box, err := secretCipher()
	if err != nil {
		return "", err
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, "aesgcm:v1:"))
	if err != nil || len(data) < box.NonceSize()+box.Overhead() {
		return "", errors.New("加密数据无效")
	}
	plain, err := box.Open(nil, data[:box.NonceSize()], data[box.NonceSize():], []byte("workbench-secret-v1"))
	if err != nil {
		return "", errors.New("解密失败，请检查原服务器密钥文件")
	}
	return string(plain), nil
}
