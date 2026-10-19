package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestNewsCopySharedCases(t *testing.T) {
	content, err := os.ReadFile("../test/fixtures/news-copy-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name  string   `json:"name"`
		Text  string   `json:"text"`
		Codes []string `json:"codes"`
	}
	if err := json.Unmarshal(content, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			reasons := newsCopyRejectionReasons(tc.Text)
			if len(reasons) != len(tc.Codes) {
				t.Fatalf("wanted %v, got %v", tc.Codes, reasons)
			}
			for index, code := range tc.Codes {
				if !strings.Contains(reasons[index], "["+code+"]") {
					t.Fatalf("wanted %s, got %s", code, reasons[index])
				}
			}
		})
	}
}

func TestStoryCopyTemplatesTriggerWholeDraftRepair(t *testing.T) {
	for _, text := range []string{
		"韩国财长预计半导体景气持续到2027年；2029年内存供需走向属于行业预测。",
		"Kotaku报道，创作者称使用Claude制作了这个游戏项目，在收到律师函后停止开发。",
		"仓库将它描述为面向开放任务的递归智能体框架，并称模型权重保持不变。",
		"Typora官方补充说明，现有V1付费用户升级至V2可免费，无需再次购买。",
		"团队演示了利用AI生成游戏内容的项目；报道没有显示厂商宣布新的防作弊方案。",
		"Typora称现有V1付费用户升级至V2可免费，无需再次购买许可证或订阅额外的服务。",
	} {
		for _, field := range []string{"scene", "tab"} {
			t.Run(field+"/"+text, func(t *testing.T) {
				draft := fixtureCompleteStoryDraft()
				if field == "scene" {
					draft.Scenes[0].Subtitle = text
				} else {
					draft.Tabs[0].Summary = "**" + text + "**"
				}
				draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
				groups := []NewsGroup{{Title: "原始新闻选题", SourceIndexes: []int{1}}}
				batch := []storyTabMaterial{{GroupIndex: 1, Body: "已提供的新闻材料"}}
				repairs := applyStoryTabsResults(groups, batch, []StoryTabsResult{draft})
				if len(repairs) != 1 || !strings.Contains(joinMaterialBodies(repairs), newsCopyRejectionReasons(text)[0]) {
					t.Fatalf("missing specific rewrite feedback: %+v", repairs)
				}
				if len(groups[0].Scenes) != 0 || len(groups[0].Tabs) != 0 {
					t.Fatal("rejected draft was partially committed")
				}
			})
		}
	}
}

func TestStoryCopyRepairAcceptsDirectPolicyWithConditions(t *testing.T) {
	draft := StoryTabsResult{GroupIndex: 1, ContentTitle: "Typora开放V2候补登记", NavigationTitle: "Typora",
		Tabs:   []StoryTab{{Title: "升级政策", Summary: "现有`Typora V1`付费用户**可免费升级至V2**，无需再次购买软件许可证。", EvidenceIndexes: []int{1}}},
		Scenes: []StoryScene{{Subtitle: "Typora官方补充说明，现有V1付费用户升级至V2可免费，无需再次购买。", EvidenceIndexes: []int{1}}},
	}
	draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
	groups := []NewsGroup{{Title: draft.ContentTitle, SourceIndexes: []int{1}}}
	repairs := applyStoryTabsResults(groups, []storyTabMaterial{{GroupIndex: 1, Body: "产品升级政策来源"}}, []StoryTabsResult{draft})
	if len(repairs) != 1 {
		t.Fatalf("expected an editorial rewrite, got %v", repairs)
	}
	draft.Scenes[0].Subtitle = "现有Typora V1付费用户可免费升级至V2，无需再次购买软件许可证。"
	draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
	if pending := applyStoryTabsResults(groups, repairs, []StoryTabsResult{draft}); len(pending) != 0 {
		t.Fatalf("direct policy requested another rewrite: %v", pending)
	}
	if !storyTabsContentReady(groups[0]) || groups[0].Scenes[0].Subtitle != draft.Scenes[0].Subtitle {
		t.Fatal("corrected policy was not retained intact")
	}
}

func TestBriefFactsNeedNoPaddingToPassTheProductionLoop(t *testing.T) {
	const subtitle = "现有Typora V1付费用户可免费升级至V2。"
	good := StoryTabsResult{GroupIndex: 1, ContentTitle: "Typora V1用户可免费升级V2", NavigationTitle: "Typora",
		Tabs:   []StoryTab{{Title: "升级资格", Summary: "现有`Typora V1`付费用户**可免费升级至V2**。", EvidenceIndexes: []int{1}}},
		Scenes: []StoryScene{{Subtitle: subtitle, EvidenceIndexes: []int{1}}},
	}
	good.NarrationReview = fixtureNarrationReview(good.Scenes)
	bad := good
	bad.Scenes = []StoryScene{{Subtitle: "Typora官方补充说明，现有V1付费用户升级至V2可免费，无需再次购买。", EvidenceIndexes: []int{1}}}
	bad.NarrationReview = fixtureNarrationReview(bad.Scenes)
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []ChatMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requests = append(requests, request.Messages[len(request.Messages)-1].Content)
		draft := good
		if len(requests) == 1 {
			draft = bad
		}
		content, _ := json.Marshal([]StoryTabsResult{draft})
		_ = json.NewEncoder(w).Encode(ChatResponse{Choices: []ChatChoice{{Message: ChatMessage{Content: string(content)}}}})
	}))
	defer server.Close()
	groups, err := generateStoryTabs(AIConfig{BaseURL: server.URL, Model: "test", APIKey: "test"},
		[]NewsGroup{{Title: good.ContentTitle, SourceIndexes: []int{1}}},
		[]Item{{Title: good.ContentTitle, Description: "现有 Typora V1 付费用户可免费升级至 V2。"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 || !strings.Contains(requests[1], "supplementary-preface") || !strings.Contains(requests[1], "现有 Typora V1") {
		t.Fatalf("expected original evidence and precise rewrite feedback, got %v", requests)
	}
	if len(groups) != 1 || groups[0].Scenes[0].Subtitle != subtitle {
		t.Fatalf("direct brief was padded, rejected or replaced: %#v", groups)
	}
}

func TestShortCopyStillNeedsCompleteSentencesAndCoreCoverage(t *testing.T) {
	for _, subtitle := range []string{"", "太短", "现有Typora V1付费用户可免费升级至"} {
		if normalizeSceneSubtitle(subtitle) != "" {
			t.Fatalf("accepted fragment %q", subtitle)
		}
	}
	group := NewsGroup{SourceIndexes: []int{1}, Scenes: []StoryScene{{Subtitle: "Typora开放V2候补登记。", EvidenceIndexes: []int{1}}},
		NarrationReview: NarrationReview{Takeaway: "V1用户免费升级", CoreFacts: []NarrationCoreFact{{Fact: "V1付费用户免费升级至V2", SpokenEvidence: "现有Typora V1付费用户可免费升级至V2。", EvidenceIndexes: []int{1}}}},
	}
	if len(narrationRejectionReasons(group)) == 0 {
		t.Fatal("brief omitted its core upgrade policy")
	}
}

func TestValidCopyNeedsOnlyOneGeneration(t *testing.T) {
	draft := StoryTabsResult{GroupIndex: 1, ContentTitle: "半导体景气与内存市场预测", NavigationTitle: "内存市场",
		Tabs:   []StoryTab{{Title: "行业走势", Summary: "财长预计**半导体繁荣至少持续到2027年**，行业另预计2029年内存市场可能进入红海竞争。", EvidenceIndexes: []int{1}}},
		Scenes: []StoryScene{{Subtitle: "财长预计，半导体繁荣至少持续到2027年。行业分析另预计，2029年内存市场可能进入红海竞争。", EvidenceIndexes: []int{1}}},
	}
	draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
	server, requests := copyTestServer(t, []StoryTabsResult{draft})
	defer server.Close()
	const source = "原始来源：财长预计半导体景气至少持续到2027年。行业分析另预计2029年内存市场可能进入红海竞争。"
	groups, err := generateStoryTabsFromMaterials(AIConfig{BaseURL: server.URL, Model: "test", APIKey: "test"},
		[]NewsGroup{{Title: draft.ContentTitle, SourceIndexes: []int{1}}}, []storyTabMaterial{{GroupIndex: 1, Body: source}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(*requests) != 1 {
		t.Fatalf("valid copy must need exactly one model call, got %d", len(*requests))
	}
	request := (*requests)[0]
	if len(request) != 2 || request[0].Content != storyTabsSystemPrompt || !strings.Contains(request[1].Content, source) {
		t.Fatal("first generation must receive the writing rules and original sources")
	}
	if groups[0].Scenes[0].Subtitle != draft.Scenes[0].Subtitle {
		t.Fatal("valid first-generation copy was changed")
	}
}

func TestRepairMaterialKeepsOnlyTheCurrentDraft(t *testing.T) {
	draft := fixtureCompleteStoryDraft()
	draft.Scenes[0].Subtitle = "Typora官方补充说明，现有V1付费用户升级至V2可免费，无需再次购买。"
	draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
	oldSubtitle := draft.Scenes[0].Subtitle
	groups := []NewsGroup{{Title: draft.ContentTitle, SourceIndexes: []int{1}}}
	batch := applyStoryTabsResults(groups, []storyTabMaterial{{GroupIndex: 1, Body: "原始来源材料"}}, []StoryTabsResult{draft})
	if len(batch) != 1 {
		t.Fatal("expected precise feedback for the first rejected draft")
	}
	draft.Scenes[0].Subtitle = "仓库将它描述为面向开放任务的递归智能体框架，并称模型权重保持不变。"
	draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
	batch = applyStoryTabsResults(groups, batch, []StoryTabsResult{draft})
	prompt := joinMaterialBodies(batch)
	if strings.Count(prompt, "原始来源材料") != 1 || strings.Contains(prompt, oldSubtitle) || !strings.Contains(prompt, draft.Scenes[0].Subtitle) {
		t.Fatal("repair accumulated stale drafts or duplicated the original sources")
	}
}

func copyTestServer(t *testing.T, drafts []StoryTabsResult) (*httptest.Server, *[][]ChatMessage) {
	t.Helper()
	requests := new([][]ChatMessage)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []ChatMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		index := min(len(*requests), len(drafts)-1)
		*requests = append(*requests, request.Messages)
		content, _ := json.Marshal([]StoryTabsResult{drafts[index]})
		_ = json.NewEncoder(w).Encode(ChatResponse{Choices: []ChatChoice{{Message: ChatMessage{Content: string(content)}}}})
	}))
	return server, requests
}
