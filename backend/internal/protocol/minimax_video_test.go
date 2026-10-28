package protocol

import (
	"context"
	"strconv"
	"strings"
	"testing"
)

func TestMiniMaxVideoDurationOptions(t *testing.T) {
	adapter := officialPackageAdapter(t, "minimax-hailuo-video-v2.yingce-plugin", "minimax-video")
	for _, parameter := range adapter.Metadata().Parameters {
		if parameter.Name != "duration" {
			continue
		}
		if len(parameter.Values) != 27 {
			t.Fatalf("duration options = %v, want every second from 4 through 30", parameter.Values)
		}
		for index, value := range parameter.Values {
			if value != strconv.Itoa(index+4) {
				t.Fatalf("duration option %d = %q", index, value)
			}
		}
		return
	}
	t.Fatal("duration parameter is missing")
}

func TestMiniMaxVideoDurationRange(t *testing.T) {
	adapter := officialPackageAdapter(t, "minimax-hailuo-video-v2.yingce-plugin", "minimax-video")
	for seconds := 4; seconds <= 30; seconds++ {
		t.Run(strconv.Itoa(seconds), func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "MiniMax-H3", Prompt: "a clip", Duration: seconds}})
			if err != nil {
				t.Fatal(err)
			}
			if duration := manifestTestBody(t, spec)["duration"]; duration != float64(seconds) {
				t.Fatalf("upstream duration = %#v, want %d", duration, seconds)
			}
		})
	}
	for _, seconds := range []int{3, 31} {
		t.Run("reject-"+strconv.Itoa(seconds), func(t *testing.T) {
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "MiniMax-H3", Prompt: "a clip", Duration: seconds}})
			if err == nil || !strings.Contains(err.Error(), "duration 必须在 4-30 秒之间") {
				t.Fatalf("duration %d error = %v", seconds, err)
			}
		})
	}
}

func TestMiniMaxVideoFailureMessages(t *testing.T) {
	adapter := officialPackageAdapter(t, "minimax-hailuo-video-v2.yingce-plugin", "minimax-video")
	const dimensionError = "content[1].image_url: media dimensions must be between 256 and 5760 pixels"
	for _, tc := range []struct {
		name, payload, message string
		status                 Status
	}{
		{"nested task error", `{"task":{"id":"video-1","status":"failed","error":{"code":"2013","message":"` + dimensionError + `"}}}`, dimensionError, StatusFailed},
		{"nested error without status", `{"task":{"id":"video-1","error":{"code":"2013","message":"` + dimensionError + `"}}}`, dimensionError, StatusFailed},
		{"specific error precedes envelope", `{"base_resp":{"status_code":0,"status_msg":"success"},"task":{"id":"video-1","status":"failed","message":"task failed","error":{"code":"2013","message":"` + dimensionError + `"}}}`, dimensionError, StatusFailed},
		{"base response error", `{"task_id":"video-1","base_resp":{"status_code":2013,"status_msg":"invalid input"}}`, "invalid input", StatusFailed},
		{"task message", `{"task":{"id":"video-1","status":"failed","message":"task rejected"}}`, "task rejected", StatusFailed},
		{"successful task", `{"task":{"id":"video-1","status":"succeeded","error":{"code":0},"content":{"url":"https://cdn.example/video.mp4"}}}`, "", StatusSucceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created, err := adapter.ParseCreate(context.Background(), []byte(tc.payload))
			if err != nil {
				t.Fatal(err)
			}
			if created.TaskID != "video-1" || created.Status != tc.status || created.Message != tc.message {
				t.Fatalf("create = %#v, want status %s and message %q", created, tc.status, tc.message)
			}
			polled, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "video-1"}, []byte(tc.payload))
			if err != nil {
				t.Fatal(err)
			}
			if polled.TaskID != "video-1" || polled.Status != tc.status || polled.Message != tc.message {
				t.Fatalf("poll = %#v, want status %s and message %q", polled, tc.status, tc.message)
			}
		})
	}
}

func TestMiniMaxVideoCreateIncludesEnabledOutputFieldsOnly(t *testing.T) {
	adapter := officialPackageAdapter(t, "minimax-hailuo-video-v2.yingce-plugin", "minimax-video")
	for _, tc := range []struct {
		name    string
		enabled bool
	}{
		{name: "disabled", enabled: false},
		{name: "enabled", enabled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: "MiniMax-H3", Prompt: "A static gray circle.", Duration: 6, Resolution: "768P", AspectRatio: "16:9",
				GenerateAudio: tc.enabled, Watermark: tc.enabled,
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			for _, field := range []string{"aigc_watermark", "generate_audio"} {
				value, exists := body[field]
				if exists != tc.enabled {
					t.Fatalf("%s exists = %v, want %v: %#v", field, exists, tc.enabled, body)
				}
				if tc.enabled && value != true {
					t.Fatalf("%s = %#v, want true", field, value)
				}
			}
		})
	}
}

func TestMiniMaxVideoAcceptsKeyframeWithReferenceImage(t *testing.T) {
	adapter := officialPackageAdapter(t, "minimax-hailuo-video-v2.yingce-plugin", "minimax-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "MiniMax-H3", Prompt: "保持角色一致", Duration: 6, AspectRatio: "16:9",
		Images: []MediaReference{
			{Role: "first_frame", URL: "https://cdn.example/first.png", Order: 1},
			{Role: "reference_image", URL: "https://cdn.example/reference.png", Order: 2},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	content, _ := body["content"].([]any)
	if len(content) != 3 {
		t.Fatalf("content = %#v", content)
	}
	first, _ := content[1].(map[string]any)
	reference, _ := content[2].(map[string]any)
	if first["role"] != "first_frame" || reference["role"] != "reference_image" || body["ratio"] != "adaptive" {
		t.Fatalf("combined keyframe request = %#v", body)
	}
}
