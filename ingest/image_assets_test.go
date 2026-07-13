package main

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
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

func avifHeaderWithDimensions(width, height uint32) []byte {
	data := make([]byte, 40)
	copy(data[4:8], "ftyp")
	data[20], data[21], data[22], data[23] = 0, 0, 0, 20
	copy(data[24:28], "ispe")
	data[32], data[33], data[34], data[35] = byte(width>>24), byte(width>>16), byte(width>>8), byte(width)
	data[36], data[37], data[38], data[39] = byte(height>>24), byte(height>>16), byte(height>>8), byte(height)
	return data
}

func avifIspeBox(width, height uint32) []byte {
	box := make([]byte, 20)
	box[3] = 20
	copy(box[4:8], "ispe")
	box[12], box[13], box[14], box[15] = byte(width>>24), byte(width>>16), byte(width>>8), byte(width)
	box[16], box[17], box[18], box[19] = byte(height>>24), byte(height>>16), byte(height>>8), byte(height)
	return box
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

func TestFetchOverlayImageRetriesTransientNetworkFailure(t *testing.T) {
	oldSleep := overlayImageRetrySleep
	overlayImageRetrySleep = func(time.Duration) {}
	t.Cleanup(func() { overlayImageRetrySleep = oldSleep })

	attempts := 0
	client := &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			attempts++
			if attempts == 1 {
				return nil, errors.New("net/http: TLS handshake timeout")
			}
			return &http.Response{
				StatusCode:    http.StatusOK,
				Header:        http.Header{"Content-Type": []string{"image/png"}},
				Body:          io.NopCloser(bytes.NewReader(onePixelPNG())),
				ContentLength: int64(len(onePixelPNG())),
				Request:       req,
			}, nil
		}),
	}

	data, ext, err := fetchOverlayImage(client, "https://cdn.example.com/a.png", "")
	if err != nil {
		t.Fatalf("fetchOverlayImage() error: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
	if ext != ".png" {
		t.Errorf("extension = %q, want .png", ext)
	}
	if len(data) == 0 {
		t.Error("data is empty")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
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

func TestAVIFOverlaySupport(t *testing.T) {
	data := avifHeaderWithDimensions(578, 500)
	width, height := decodeOverlayImageDimensions(data)
	if width != 578 || height != 500 {
		t.Fatalf("decodeOverlayImageDimensions() = %dx%d, want 578x500", width, height)
	}
	if got := supportedOverlayImageExtensionFromURL("https://cdn.example.com/product.avif"); got != ".avif" {
		t.Fatalf("URL extension = %q, want .avif", got)
	}
	if got := supportedOverlayImageExtensionFromContentType("image/avif"); got != ".avif" {
		t.Fatalf("content extension = %q, want .avif", got)
	}
	root := t.TempDir()
	if _, err := saveOverlayImage(data, "product.avif", root); err != nil {
		t.Fatalf("saveOverlayImage(avif) error: %v", err)
	}
}

func TestDecodeAVIFDimensionsPrefersPrimaryCanvasOverEarlierThumbnail(t *testing.T) {
	ftyp := []byte{0, 0, 0, 8, 'f', 't', 'y', 'p'}
	data := append(append(append([]byte(nil), ftyp...), avifIspeBox(160, 90)...), avifIspeBox(1920, 1080)...)
	width, height := decodeAVIFDimensions(data)
	if width != 1920 || height != 1080 {
		t.Fatalf("decodeAVIFDimensions() = %dx%d, want main canvas 1920x1080", width, height)
	}
}
