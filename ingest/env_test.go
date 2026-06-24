package main

import "testing"

func TestCleanProjectEnvValueStripsInlineComment(t *testing.T) {
	got := cleanProjectEnvValue("true                # true enables automatic overlays")
	if got != "true" {
		t.Fatalf("cleanProjectEnvValue() = %q, want true", got)
	}
}

func TestCleanProjectEnvValueKeepsQuotedHash(t *testing.T) {
	got := cleanProjectEnvValue(`"value # not a comment" # comment`)
	if got != "value # not a comment" {
		t.Fatalf("cleanProjectEnvValue() = %q", got)
	}
}

func TestCleanProjectEnvValueKeepsJSONHash(t *testing.T) {
	got := cleanProjectEnvValue(`{"text":"value # not a comment"} # comment`)
	if got != `{"text":"value # not a comment"}` {
		t.Fatalf("cleanProjectEnvValue() = %q", got)
	}
}

func TestReadBoolEnvFallsBackOnInvalidValue(t *testing.T) {
	t.Setenv("CLAUDE_VISION_ENABLED", "true # inline comment")

	if !readBoolEnv("CLAUDE_VISION_ENABLED", true) {
		t.Fatal("readBoolEnv() should use fallback true for invalid bool")
	}
}
