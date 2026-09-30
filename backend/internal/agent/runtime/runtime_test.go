package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckPiRuntimeDependency(t *testing.T) {
	dir := t.TempDir()
	err := checkPiRuntimeDependency(dir)
	if err == nil {
		t.Fatal("missing Pi dependency did not return an error")
	}
	if !strings.Contains(err.Error(), "npm ci --omit=dev --ignore-scripts") {
		t.Fatalf("missing dependency error = %q; want installation command", err)
	}

	packagePath := filepath.Join(dir, piCodingAgentPackage)
	if err := os.MkdirAll(filepath.Dir(packagePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(packagePath, []byte(`{"name":"@earendil-works/pi-coding-agent"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := checkPiRuntimeDependency(dir); err != nil {
		t.Fatalf("installed Pi dependency returned an error: %v", err)
	}
}
