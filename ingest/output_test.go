package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"
)

func TestPrintNewsGroupsCleansPreviewTitlesButKeepsOriginalSourceTitle(t *testing.T) {
	groups := []NewsGroup{{
		Title:  "OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？",
		Reason: "测试预览标题清理",
		Score:  9,
		Tabs:   []StoryTab{{Title: "事件概览", Summary: "这是足够长的摘要内容用于通过字数校验。"}},
		Highlights: []NewsHighlight{{
			Index: 1,
			Point: "OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？",
		}},
	}}
	items := []Item{{
		Title:      "OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？",
		SourceName: "Linux.do 前沿快讯",
		Link:       "https://linux.do/t/topic/2468202",
	}}

	var buf bytes.Buffer
	oldStdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	printNewsGroups(groups, items)
	writer.Close()
	os.Stdout = oldStdout
	if _, err := io.Copy(&buf, reader); err != nil {
		t.Fatal(err)
	}

	output := buf.String()
	if strings.Contains(output, "[9/10] OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？") {
		t.Fatalf("preview group title kept trailing question marks:\n%s", output)
	}
	if strings.Contains(output, "1) OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？") {
		t.Fatalf("preview highlight kept trailing question marks:\n%s", output)
	}
	if !strings.Contains(output, "原文: OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？") {
		t.Fatalf("source title should remain original for traceability:\n%s", output)
	}
}
