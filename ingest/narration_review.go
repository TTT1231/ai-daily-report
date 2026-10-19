package main

import (
	"fmt"
	"strings"
)

// narrationRejectionReasons checks an explicit editorial choice against the actual
// spoken draft. It deliberately does not guess semantics from product keywords.
func narrationRejectionReasons(group NewsGroup) []string {
	review := group.NarrationReview
	var reasons []string
	if strings.TrimSpace(review.Takeaway) == "" {
		reasons = append(reasons, "narration_review.takeaway 缺失：先确定观众最应记住的事件或变化")
	}
	if len(review.CoreFacts) == 0 {
		return append(reasons, "narration_review.core_facts 缺失：列出不可遗漏的具体事实，并引用实际口播原句，不能只在 Tabs 中解释")
	}
	validSources := make(map[int]bool, len(group.SourceIndexes))
	for _, index := range group.SourceIndexes {
		validSources[index] = true
	}
	for index, core := range review.CoreFacts {
		label := fmt.Sprintf("narration_review.core_facts[%d]", index)
		quote := strings.TrimSpace(core.SpokenEvidence)
		if strings.TrimSpace(core.Fact) == "" || quote == "" {
			reasons = append(reasons, label+" 必须给出完整核心事实及其 spoken_evidence 口播原句")
			continue
		}
		if len(core.EvidenceIndexes) == 0 {
			reasons = append(reasons, label+" 缺少来源 evidence_indexes")
			continue
		}
		valid := true
		seen := make(map[int]bool)
		for _, source := range core.EvidenceIndexes {
			if !validSources[source] || seen[source] {
				valid = false
			}
			seen[source] = true
		}
		if !valid {
			reasons = append(reasons, label+" 的来源必须有效且不重复")
			continue
		}
		covered := false
		for _, scene := range group.Scenes {
			if !strings.Contains(scene.Subtitle, quote) {
				continue
			}
			sceneSources := make(map[int]bool, len(scene.EvidenceIndexes))
			for _, source := range scene.EvidenceIndexes {
				sceneSources[source] = true
			}
			covered = true
			for _, source := range core.EvidenceIndexes {
				if !sceneSources[source] {
					covered = false
				}
			}
			if covered {
				break
			}
		}
		if !covered {
			reasons = append(reasons, label+" 的核心事实没有对应有效 Scene 的实际原句和来源；必须补讲，不能用标题或 Tab 代替")
		}
	}
	return reasons
}
