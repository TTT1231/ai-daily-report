package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// onePixelPNG is a valid 1x1 transparent PNG used to exercise the download path.
func onePixelPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
		0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x00, 0x00,
		0x01, 0x01, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa1, 0x59, 0x7a, 0xc6, 0x00,
		0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
}

func TestFetchOverlayImage(t *testing.T) {
	t.Setenv("all_proxy", "") // 避免本机 all_proxy 干扰 httptest（127.0.0.1）
	var gotReferer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReferer = r.Header.Get("Referer")
		w.Header().Set("Content-Type", "image/png")
		w.Write(onePixelPNG())
	}))
	defer srv.Close()

	data, ext, err := fetchOverlayImage(newHTTPClient(defaultFeedRequestTimeout, false, false), srv.URL+"/a.png", "https://example.com/topic/1")
	if err != nil {
		t.Fatalf("fetchOverlayImage() error: %v", err)
	}
	if ext != ".png" {
		t.Errorf("extension = %q, want .png", ext)
	}
	if len(data) == 0 {
		t.Error("data is empty")
	}
	if gotReferer != "https://example.com/topic/1" {
		t.Errorf("Referer = %q, want the source link", gotReferer)
	}
}

func TestSaveOverlayImage(t *testing.T) {
	root := t.TempDir()
	got, err := saveOverlayImage(onePixelPNG(), "scene-1-1.png", root)
	if err != nil {
		t.Fatalf("saveOverlayImage() error: %v", err)
	}
	if got.Path != "images/scene-1-1.png" {
		t.Errorf("Path = %q, want images/scene-1-1.png", got.Path)
	}
	if got.Width != 1 || got.Height != 1 {
		t.Errorf("dims = %dx%d, want 1x1", got.Width, got.Height)
	}
	if _, err := os.Stat(filepath.Join(root, "data-scheme", "images", "scene-1-1.png")); err != nil {
		t.Errorf("file not written: %v", err)
	}
}
