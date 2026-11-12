//go:build windows

package app

import (
	"os/exec"
	"strconv"
	"syscall"
)

func configureDouyinProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Cancel = func() error { stopDouyinProcess(cmd); return nil }
}
func stopDouyinProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// Only the dedicated Node child and the Edge contexts it created are stopped.
	killer := exec.Command("taskkill.exe", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F")
	killer.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if killer.Run() != nil {
		cmd.Process.Kill()
	}
}
