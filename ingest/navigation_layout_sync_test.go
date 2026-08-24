package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type navigationWidthCase struct {
	Label     string `json:"label"`
	ItemCount int    `json:"itemCount"`
	Active    bool   `json:"active"`
	Expected  int    `json:"expected"`
}

type navigationWidthFixture struct {
	MinimumWidth           []navigationWidthCase `json:"minimumWidth"`
	BottomItemMinimumWidth []navigationWidthCase `json:"bottomItemMinimumWidth"`
}

// TestNavigationWidthFixtureSync 钉住「同一输入 → 同一宽度」的三语言契约：
// 期望值由 scripts/lib/navigation-layout.mjs 生成（fixture 的 comment 有再生成说明），
// TS 渲染侧由 test/unit/navigation-layout-consistency.test.ts 核对。这里失败说明
// ingest 的宽度估算与渲染/校验口径漂移，必须三处一起改，不能只改 Go。
func TestNavigationWidthFixtureSync(t *testing.T) {
	root, err := projectRoot()
	if err != nil {
		t.Fatalf("projectRoot() 失败: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "test", "fixtures", "navigation-width-cases.json"))
	if err != nil {
		t.Fatalf("读取 fixture 失败: %v", err)
	}
	var fixture navigationWidthFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("解析 fixture 失败: %v", err)
	}
	if len(fixture.MinimumWidth) == 0 || len(fixture.BottomItemMinimumWidth) == 0 {
		t.Fatal("fixture 为空，疑似生成脚本未跑或文件损坏")
	}

	layout, err := loadNavigationLayout()
	if err != nil {
		t.Fatalf("loadNavigationLayout() 失败: %v", err)
	}

	for _, c := range fixture.MinimumWidth {
		if got := layout.minimumWidth(c.Label, c.ItemCount); got != float64(c.Expected) {
			t.Errorf("minimumWidth(%q, %d) = %v, fixture 期望 %d", c.Label, c.ItemCount, got, c.Expected)
		}
	}
	for _, c := range fixture.BottomItemMinimumWidth {
		if got := layout.bottomItemMinimumWidth(c.Label, c.Active); got != float64(c.Expected) {
			t.Errorf("bottomItemMinimumWidth(%q, %v) = %v, fixture 期望 %d", c.Label, c.Active, got, c.Expected)
		}
	}
}

// TestASCIIWidthUnitMatchesConfig 防止 Go 纯函数里的 ASCII 宽度近似值与
// video-layout.json 的 navigation.asciiWidthFactor 漂移：改配置必须同步改常量。
func TestASCIIWidthUnitMatchesConfig(t *testing.T) {
	layout, err := loadNavigationLayout()
	if err != nil {
		t.Fatalf("loadNavigationLayout() 失败: %v", err)
	}
	if layout.ASCIIWidthFactor != asciiWidthUnit {
		t.Errorf(
			"asciiWidthUnit 常量 (%v) 与 video-layout.json 的 asciiWidthFactor (%v) 不一致；改配置时请同步常量",
			asciiWidthUnit,
			layout.ASCIIWidthFactor,
		)
	}
}
