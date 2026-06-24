package main

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"
)

// plannedManualImage 是 vision-off 模式下计划下载的一张候选图。
type plannedManualImage struct {
	SceneNum    int    // 全局场景号（按 data.json 最终顺序，1 基）
	Candidate   int    // 同一场景内的候选序号（1 基）
	ImageURL    string // 远程图片地址
	RefererLink string // 来源链接，作为下载 Referer
}

// planManualCandidates 按 data.json 的最终场景顺序，为每个 Score>=9 且含远程图的 scene
// 收集候选远程图片，每场景最多 maxImages 张。纯函数：不做网络或磁盘 IO。
func planManualCandidates(report DataJSON, groups []NewsGroup, items []Item, maxImages int) []plannedManualImage {
	if maxImages <= 0 {
		maxImages = 1
	}
	var plans []plannedManualImage
	sceneNum := 0
	seenURLs := make(map[string]bool)
	for _, story := range report.Stories {
		groupIndex := story.sourceGroupIndex
		eligible := groupIndex >= 0 && groupIndex < len(groups) && groups[groupIndex].Score >= 9
		var group NewsGroup
		if groupIndex >= 0 && groupIndex < len(groups) {
			group = groups[groupIndex]
		}
		for scIdx := range story.Scenes {
			sceneNum++
			if !eligible || scIdx >= len(group.Tabs) {
				continue
			}
			tab := group.Tabs[scIdx]
			cand := 0
			for _, index := range tab.EvidenceIndexes {
				if index < 1 || index > len(items) {
					continue
				}
				item := items[index-1]
				for _, u := range extractRemoteImageURLs(item.Description) {
					if seenURLs[u] || cand >= maxImages {
						continue
					}
					seenURLs[u] = true
					cand++
					plans = append(plans, plannedManualImage{
						SceneNum:    sceneNum,
						Candidate:   cand,
						ImageURL:    u,
						RefererLink: item.Link,
					})
				}
			}
		}
	}
	return plans
}

// downloadManualCandidateImages 在 vision-off 模式下把候选图下载到 <rootDir>/data-scheme/images/，
// 按 scene 命名并打印文件名。供 generateDataJSON 在视觉关闭时调用。
func downloadManualCandidateImages(client *http.Client, report DataJSON, groups []NewsGroup, items []Item, rootDir string) error {
	maxImages := readPositiveIntEnv("CLAUDE_VISION_MAX_IMAGES_PER_SOURCE", 2)
	plans := planManualCandidates(report, groups, items, maxImages)
	if len(plans) == 0 {
		return nil
	}
	var names []string
	seenHashes := make(map[[32]byte]string)
	for _, p := range plans {
		data, extension, err := fetchOverlayImage(client, p.ImageURL, p.RefererLink)
		if err != nil {
			fmt.Printf("   ⚠️  警告：候选图 scene-%d-%d 下载失败，跳过：%v\n", p.SceneNum, p.Candidate, err)
			continue
		}
		hash := sha256.Sum256(data)
		if previous, exists := seenHashes[hash]; exists {
			fmt.Printf("   ⚠️  警告：候选图 scene-%d-%d 与 %s 内容重复，跳过\n", p.SceneNum, p.Candidate, previous)
			continue
		}
		width, height := decodeOverlayImageDimensions(data)
		if width <= 0 || height <= 0 {
			fmt.Printf("   ⚠️  警告：候选图 scene-%d-%d 无法解码尺寸，跳过\n", p.SceneNum, p.Candidate)
			continue
		}
		if isLikelyDecorativeCandidateImage(width, height) {
			fmt.Printf("   ⚠️  警告：候选图 scene-%d-%d 疑似头像、Logo 或小图标（%dx%d），跳过\n", p.SceneNum, p.Candidate, width, height)
			continue
		}
		filename := fmt.Sprintf("scene-%d-%d%s", p.SceneNum, p.Candidate, extension)
		if _, err := saveOverlayImage(data, filename, rootDir); err != nil {
			fmt.Printf("   ⚠️  警告：候选图 %s 写入失败，跳过：%v\n", filename, err)
			continue
		}
		seenHashes[hash] = filename
		names = append(names, filename)
	}
	if len(names) > 0 {
		fmt.Printf("   下载候选图：%s\n", strings.Join(names, "、"))
	}
	return nil
}

func isLikelyDecorativeCandidateImage(width, height int) bool {
	minSide := min(width, height)
	maxSide := max(width, height)
	if maxSide <= 0 {
		return true
	}
	squareish := maxSide*100 <= minSide*125
	return squareish && maxSide <= 256
}
