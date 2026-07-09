package main

import (
	"path/filepath"
	"testing"
)

func TestLoadPicksMissingFileReturnsEmpty(t *testing.T) {
	picks, err := loadPicks(filepath.Join(t.TempDir(), "absent.json"))
	if err != nil {
		t.Fatalf("loadPicks on missing file should not error: %v", err)
	}
	if len(picks) != 0 {
		t.Fatalf("expected empty picks, got %d", len(picks))
	}
}

func TestSaveAndLoadPicksRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "picks.json")
	original := Picks{
		"abc123": true,
		"def456": true,
	}
	if err := savePicks(path, original); err != nil {
		t.Fatalf("savePicks error = %v", err)
	}

	loaded, err := loadPicks(path)
	if err != nil {
		t.Fatalf("loadPicks error = %v", err)
	}
	if len(loaded) != len(original) {
		t.Fatalf("got %d picks, want %d", len(loaded), len(original))
	}
	for h := range original {
		if !loaded[h] {
			t.Fatalf("pick %q lost in round-trip", h)
		}
	}
}

func TestLoadPicksEmptyFileReturnsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "picks.json")
	if err := writeFileAtomic(path, []byte{}, 0o755, 0o644); err != nil {
		t.Fatal(err)
	}
	picks, err := loadPicks(path)
	if err != nil {
		t.Fatalf("loadPicks on empty file should not error: %v", err)
	}
	if len(picks) != 0 {
		t.Fatalf("expected empty picks for empty file, got %d", len(picks))
	}
}
