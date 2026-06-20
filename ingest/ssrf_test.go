package main

import (
	"net"
	"testing"
)

func TestIsBlockedIPRejectsReservedRanges(t *testing.T) {
	for _, addr := range []string{
		"127.0.0.1",       // loopback v4
		"::1",             // loopback v6
		"10.0.0.1",        // private 10/8
		"172.16.0.1",      // private 172.16/12
		"192.168.1.1",     // private 192.168/16
		"169.254.169.254", // link-local / cloud metadata
		"fe80::1",         // link-local v6
		"fc00::1",         // unique-local v6
		"0.0.0.0",         // unspecified
		"::",              // unspecified v6
		"224.0.0.1",       // multicast
	} {
		if !isBlockedIP(net.ParseIP(addr)) {
			t.Fatalf("isBlockedIP(%s) = false, want true", addr)
		}
	}
}

func TestIsBlockedIPAllowsPublicAddresses(t *testing.T) {
	for _, addr := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if isBlockedIP(net.ParseIP(addr)) {
			t.Fatalf("isBlockedIP(%s) = true, want false", addr)
		}
	}
}
