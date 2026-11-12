//go:build !windows

package app

import "os/exec"

func configureDouyinProcess(cmd *exec.Cmd) {}
func stopDouyinProcess(cmd *exec.Cmd) {
	if cmd.Process != nil {
		cmd.Process.Kill()
	}
}
