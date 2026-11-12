package main

import (
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeManualEditor struct {
	closed, activated int
	err               error
}

func (e *fakeManualEditor) close()                         { e.closed++ }
func (e *fakeManualEditor) activate(context.Context) error { e.activated++; return e.err }

func TestManualEditorLifecycle(t *testing.T) {
	a, b := &fakeManualEditor{}, &fakeManualEditor{}
	m := manualEditors{items: map[string]manualEditor{"a": a, "b": b}}
	if err := m.focus(context.Background(), "a"); err != nil || a.activated != 1 || a.closed != 0 {
		t.Fatal("preview must reuse the open editor")
	}
	m.close("a")
	if a.closed != 1 || b.closed != 0 {
		t.Fatal("reset closed another draft")
	}
	if err := m.focus(context.Background(), "a"); err == nil {
		t.Fatal("missing editor accepted")
	}
	b.err = errors.New("browser closed")
	if err := m.focus(context.Background(), "b"); err == nil || b.closed != 1 {
		t.Fatal("closed editor was retained")
	}
	m.close("")
	if a.closed != 1 || b.closed != 1 {
		t.Fatal("closed twice")
	}
}

func TestManualEditorLogoutClosesAll(t *testing.T) {
	a, b := &fakeManualEditor{}, &fakeManualEditor{}
	m := manualEditors{items: map[string]manualEditor{"a": a, "b": b}}
	m.close("")
	if a.closed != 1 || b.closed != 1 || len(m.items) != 0 {
		t.Fatal("logout left authenticated editors open")
	}
}

// Trace local helper calls: both upload entry points must remain unreachable
// from the old final-submit helpers, including after future refactoring.
func TestManualPreparationCannotReachAutomaticSubmission(t *testing.T) {
	funcs := map[string]*ast.FuncDecl{}
	entries, err := os.ReadDir("xiaohongshu")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), filepath.Join("xiaohongshu", entry.Name()), nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range file.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok {
				funcs[fn.Name.Name] = fn
			}
		}
	}
	for _, root := range []string{"Publish", "PublishVideo"} {
		if funcs[root] == nil {
			t.Fatalf("missing preparation entry %s", root)
		}
		seen := map[string]bool{}
		var walk func(string)
		walk = func(name string) {
			if name == "clickAndVerifyPublish" || name == "clickPublishButton" || name == "clickPublishWidget" {
				t.Fatalf("%s can automatically submit via %s", root, name)
			}
			if seen[name] || funcs[name] == nil {
				return
			}
			seen[name] = true
			ast.Inspect(funcs[name].Body, func(n ast.Node) bool {
				if call, ok := n.(*ast.CallExpr); ok {
					if ident, ok := call.Fun.(*ast.Ident); ok {
						walk(ident.Name)
					}
				}
				return true
			})
		}
		walk(root)
	}
}
