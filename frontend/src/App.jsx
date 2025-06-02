// frontend/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import * as paillierBigint from "paillier-bigint";
import { Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

export default function App() {
  // 1) 상태 정의
  const [keys, setKeys] = useState(null);        // { publicKey, privateKey }
  const [question, setQuestion] = useState("");  // 백엔드에서 받아온 질문

  // **음성 인식(텍스트) 상태**
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");       // 확정된(final) 텍스트
  const [interimText, setInterimText] = useState("");     // 매 onresult마다 갱신될 interim 텍스트
  const recognitionRef = useRef(null);

  // **30초 타이머 상태**
  const [timer, setTimer] = useState(30);

  const [loading, setLoading] = useState(false);
  // 최종 raw 점수 + maxPossible + percent를 모두 저장해 둡니다.
  const [rawScore, setRawScore] = useState(null);         // 말더듬 감점 + 긍정 기여
  const [maxPossible, setMaxPossible] = useState(null);   // (말더듬 제외 활성화 항목 수 × 20)
  const [percent, setPercent] = useState(null);           // rawScore/maxPossible × 100 (벌점 시 음수)
  const [grade, setGrade] = useState("");                 // “매우 우수/우수/보통/개선 필요”

  const [breakdown, setBreakdown] = useState([]); // [{ label, value, weight, rawContribution, cappedContribution }]
  const [feedback, setFeedback] = useState("");

  // 평가 항목 정의 (인덱스 3이 말더듬)
  const FEATURES = [
    { key: "length",    label: "단어 수"           }, // index = 0
    { key: "positive",  label: "긍정 표현"         }, // index = 1
    { key: "keywords",  label: "직무 키워드"       }, // index = 2
    { key: "hesitation",label: "말더듬"            }, // index = 3 → 화면에서는 제일 마지막으로 렌더링
    { key: "selflead",  label: "주도성 키워드"  }, // index = 4
    { key: "teamwork",  label: "팀워크 키워드"     }  // index = 5
  ];

  // “정수형 가중치(0~5)” 상태만 사용. 가중치가 0인 항목은 자동 제외됩니다.
  const [weights, setWeights] = useState(FEATURES.map(() => 1)); // 초기값 모두 1

  const MAX_PER_FEATURE = 20;  // 말더듬 제외 나머지 항목은 최대 20점

  // 2) Paillier 키 생성 및 질문 로드 (마운트 시 한 번)
  useEffect(() => {
    // (1) Paillier 키 생성 (2048비트)
    (async () => {
      const { publicKey, privateKey } = await paillierBigint.generateRandomKeys(2048);
      setKeys({ publicKey, privateKey });
    })();

    // (2) 첫 질문 받아오기
    fetch("/question")
      .then((res) => res.json())
      .then((data) => setQuestion(data.question))
      .catch((err) => console.error("질문 불러오기 오류:", err));

    // (3) SpeechRecognition 초기화
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (SpeechRecognition) {
      const recog = new SpeechRecognition();
      recog.lang = "ko-KR";
      recog.continuous = true;
      recog.interimResults = true;

      recog.onresult = (event) => {
        // onresult 이벤트가 발생할 때마다
        // 1) 이번 핸들링에서 “확정된(final)부분”만 newFinal에 수집
        let newFinal = "";
        // 2) 이번 핸들링에서 “중간(interim)부분”만 newInterim에 수집
        let newInterim = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            newFinal += result[0].transcript;
          } else {
            newInterim += result[0].transcript;
          }
        }

        if (newFinal) {
          // 확정(final)된 부분이 있으면 transcript에 붙이고 interim 비우기
          setTranscript((prev) => prev + newFinal + " ");
          setInterimText("");
        } else {
          // 확정된 부분이 없고 interim만 나왔으면 interim 상태만 갱신
          setInterimText(newInterim);
        }
      };

      recog.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recog;
    } else {
      console.warn("이 브라우저는 Web Speech API를 지원하지 않습니다.");
      recognitionRef.current = null;
    }
  }, []);

  // 3) 30초 타이머 관리
  useEffect(() => {
    let interval;
    if (isRecording) {
      setTimer(30);
      interval = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  // --------- 이벤트 핸들러 ---------

  // 4) 녹음 시작
  const startRecording = () => {
    if (recognitionRef.current) {
      setTranscript("");
      setInterimText("");
      setIsRecording(true);
      recognitionRef.current.start();
    } else {
      alert("이 브라우저에서는 음성 인식을 지원하지 않습니다.");
    }
  };

  // 5) 녹음 중단
  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
  };

  // 6) 슬라이더(가중치) 값 변경 (정수형)
  const handleWeightChange = (index, newValue) => {
    const copy = [...weights];
    copy[index] = parseInt(newValue, 10);
    setWeights(copy);
  };

  // --------- 텍스트→벡터 변환 함수 (말더듬 감지: 공백 앞뒤) ---------
  function extractFeaturesFromText(inputText) {
    // 1. “단독 필러” 단어 리스트
    const fillerWords = ["음", "어", "그", "저"];

    // 2. 단어 토큰으로 분리 (빈칸 기준)
    const tokens = inputText
      .trim()
      .split(/\s+/)        // 연속된 공백을 하나로 보고 split
      .filter((t) => t);   // 혹시 빈 문자열이 남으면 제거

    // 3. 단독 필러 카운트: tokens 배열에서 fillerWords에 포함된 요소 개수
    const countBasic = tokens.filter((t) => fillerWords.includes(t)).length;

    // 4. 문자 단위 반복 말더듬 (ex. “응응”, “하하하”) 검출
    //    => inputText 중간의 여러 공백/구두점 등을 제거한 뒤, “한 글자 연속 반복” 패턴 찾기
    const normalized = inputText.replace(/\s+/g, ""); // 공백을 다 없앰
    const reStutter = /([ㄱ-ㅎㅏ-ㅣ가-힣])\1+/g;
    const stutterMatches = normalized.match(reStutter) || [];
    const countStutter = stutterMatches.length;

    // 5. 총 말더듬 점수 (두 패턴 합산)
    const hesitationTotal = countBasic + countStutter;

    // 6. 나머지 피처 계산 (기존 로직 유지)
    const positiveWords = ["열정", "성실", "책임감", "도전"];
    const keywords      = ["AI", "머신러닝", "프로그래밍", "데이터"];
    const selflead      = ["주도", "기획", "자발적", "리드"];
    const teamwork      = ["팀", "협업", "소통", "의사소통"];

    // (1) 단어 수
    const wordCount = tokens.length;

    // (2) 각 피처별 단어 개수
    const countPositive = tokens.filter((w) => positiveWords.includes(w)).length;
    const countKeywords = tokens.filter((w) => keywords.includes(w)).length;
    const countSelflead = tokens.filter((w) => selflead.includes(w)).length;
    const countTeamwork = tokens.filter((w) => teamwork.includes(w)).length;

    return [
      BigInt(wordCount),        // length
      BigInt(countPositive),    // positive
      BigInt(countKeywords),    // keywords
      BigInt(hesitationTotal),  // hesitation (개선된 방식)
      BigInt(countSelflead),    // selflead
      BigInt(countTeamwork),    // teamwork
    ];
  }

  // 8) 등급 계산 (percent 기준)
  function computeGrade(percentValue) {
    if (percentValue >= 80) return "매우 우수";
    else if (percentValue >= 60) return "우수";
    else if (percentValue >= 40) return "보통";
    else return "개선 필요";
  }

  // 9) “분석 요청” 버튼 클릭 시 처리
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!keys) {
      alert("암호화 키가 아직 준비되지 않았습니다. 잠시만 기다려주세요.");
      return;
    }
    const finalText = (transcript + interimText).trim();
    if (!finalText) {
      alert("먼저 텍스트를 입력하거나 녹음해 주세요.");
      return;
    }

    setLoading(true);
    setRawScore(null);
    setMaxPossible(null);
    setPercent(null);
    setGrade("");
    setBreakdown([]);
    setFeedback("");

    try {
      // (1) 텍스트 → 정수형 벡터 (BigInt[])
      const plainVector = extractFeaturesFromText(finalText);

      // (2) “weight > 0”인 인덱스만 골라서 activeIndices 생성
      const activeIndices = weights
        .map((w, idx) => ({ w, idx }))
        .filter((item) => item.w > 0)
        .map((item) => item.idx);

      // (2-1) activeIndices가 없으면 → 모든 항목 가중치가 0 → 벌점 처리
      if (activeIndices.length === 0) {
        // 말더듬을 제외한 모든 피처(5개) × 20만큼 벌점
        const penalty = -(FEATURES.length - 1) * MAX_PER_FEATURE;
        setRawScore(penalty);
        setMaxPossible(0);
        setPercent((penalty / 1) * 100); // 음수이므로 그냥 음수 퍼센트
        setGrade("개선 필요");
        setLoading(false);
        return;
      }

      // (3) 활성화된 평문 피처(BigInt) 배열
      const plainActiveVector = activeIndices.map((i) => plainVector[i]);

      // (4) 각 피처를 공개키로 암호화 → 암호문(BigInt) 배열
      const encryptedFeatures = plainActiveVector.map((m) =>
        keys.publicKey.encrypt(m)
      );

      // (5) 서버에 암호문 문자열 + 가중치(해당 인덱스 순서대로 BigInt → string) 전송
      const payload = {
        publicKey: {
          n: keys.publicKey.n.toString(),
          g: keys.publicKey.g.toString(),
        },
        encryptedFeatures: encryptedFeatures.map((c) => c.toString()),
        weights: activeIndices.map((i) => BigInt(weights[i]).toString()),
      };

      const res = await fetch("/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // (6) 서버가 보낸 암호화된 기여도 벡터 복원 (string → BigInt)
      const encryptedContributions = data.encryptedContributions.map((c) =>
        BigInt(c)
      );

      // (7) 각 암호문을 복호화 → BigInt(원시 기여도 = value × weight)
      const decryptedContributionsInt = encryptedContributions.map((c) =>
        keys.privateKey.decrypt(c)
      );

      // (8) 원시 기여도 계산: 말더듬(인덱스=3)만 감점(음수 유지), 나머지는 양수
      const rawContributions = decryptedContributionsInt.map((v, idx) => {
        const featIdx = activeIndices[idx];
        const magnitude = Number(v); // BigInt → Number
        if (featIdx === 3) {
          // 말더듬은 감점(음수)
          return -magnitude;
        }
        return magnitude; // 나머지는 양수
      });

      // (9) breakdown 생성: { label, value, weight, rawContribution, cappedContribution }
      const breakdownArr = activeIndices.map((featIdx, idx) => {
        const valueNum    = Number(plainVector[featIdx]); // 원본 피처 값
        const weightNum   = weights[featIdx];              // 슬라이더 가중치
        const rawContrib  = rawContributions[idx];         // value × weight (음수 가능)
        let cappedContrib = 0;

        if (featIdx === 3) {
          // 말더듬: 음수 그대로
          cappedContrib = rawContrib;
        } else {
          // 그 외: 0 이상이므로 최대 20으로 캡핑
          cappedContrib = Math.min(rawContrib, MAX_PER_FEATURE);
        }

        return {
          label: FEATURES[featIdx].label,
          value: valueNum,
          weight: weightNum,
          rawContribution: rawContrib,
          cappedContribution: cappedContrib,
        };
      });
      setBreakdown(breakdownArr);

      // (10) 최종 rawScore, maxPossible 계산
      //   (a) 말더듬 감점 합산 (rawContribution이 음수)
      const totalHesitationDeduction = breakdownArr
        .filter((item) => item.label === "말더듬")
        .reduce((acc, item) => acc + item.rawContribution, 0);

      //   (b) 말더듬 제외한 항목의 cappedContribution 합산 (각 항목 최대 20점)
      const totalPositive = breakdownArr
        .filter((item) => item.label !== "말더듬")
        .reduce((acc, item) => acc + item.cappedContribution, 0);

      //   (c) rawTotal = totalPositive + totalHesitationDeduction
      let rawTotal = totalPositive + totalHesitationDeduction;
      if (rawTotal < 0) rawTotal = 0; // 음수면 0으로 클램프

      //   (d) maxPossible = 활성화된 말더듬 제외 항목 개수 × MAX_PER_FEATURE
      const nonHesitationCount = activeIndices.filter((i) => i !== 3).length;
      const maxPos = nonHesitationCount * MAX_PER_FEATURE;

      setRawScore(rawTotal);
      setMaxPossible(maxPos);

      // (11) percent 및 grade 계산
      let perc = 0;
      if (maxPos > 0) {
        perc = Math.round((rawTotal / maxPos) * 100);
      } else {
        // maxPos == 0 인 경우(말더듬만 있거나, 말더듬을 포함해서도 제외), 벌점 이미 처리되어 rawScore이 0일 수 있음.
        // 퍼센트 정의: rawScore/maxPos는 불가. “1”로 나누고 *100 하되 rawScore이 0이므로 perc=0
        perc = 0;
      }
      setPercent(perc);
      setGrade(computeGrade(perc));

      // (12) GPT API 호출: “원문 텍스트는 절대 포함하지 않음”
      const OPENAI_API_KEY = "GPT_API_KEY"; // 예시 키
      let prompt = `
당신은 민감한 사용자의 텍스트를 직접 보지 않고, 수치 기반 분석 결과만으로 AI 면접 피드백을 생성하는 전문 평가자입니다.

아래는 면접 질문과, 해당 질문에 대한 사용자의 암호화된 응답을 평가한 수치적 분석 결과입니다.
실제 텍스트는 보안상 제공되지 않으며, 다음 항목별 수치와 가중치에 따라 평가가 이루어졌습니다.

면접 질문: "${question}"

항목별 평가 결과:
`;
      breakdownArr.forEach((b) => {
        prompt += `- ${b.label}: 값=${b.value}, 가중치=${b.weight}, 원시 기여도=${b.rawContribution}, 캡핑 기여도=${b.cappedContribution}\n`;
      });
      prompt += `
- 말더듬 감점 합계: ${totalHesitationDeduction < 0 ? totalHesitationDeduction : 0}
- 말더듬 제외한 항목 합산(각 항목 20점 캡핑): ${totalPositive}
- 최종 raw 점수: ${rawTotal} / ${maxPos === 0 ? 0 : maxPos}
- 퍼센트: ${perc}%
- 평가 등급: ${computeGrade(perc)}

※ 답변 텍스트는 보안 정책상 제공되지 않았다는 점을 전제로 해야 합니다.
`;
      const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const gptJson = await gptRes.json();
      const gptContent = gptJson.choices?.[0]?.message?.content || "AI 피드백 생성에 실패했습니다.";
      setFeedback(gptContent);
    } catch (err) {
      console.error(err);
      alert("오류가 발생했습니다:\n" + err.message);
    }

    setLoading(false);
  };

  return (
    <div className="container">
      <header className="question-header">
        <h2>면접 질문: {question || "질문을 불러오는 중..."}</h2>
      </header>

      {/* 2열 레이아웃: 텍스트 입력 + 타이머/녹음 */}
      <section className="input-section">
        {/* 왼쪽: 텍스트 입력 */}
        <div className="text-input-container">
          <label>📝 답변 텍스트 입력:</label>
          <textarea
            rows={4}
            value={transcript + interimText}
            onChange={(e) => {
              // 사용자가 직접 편집하면 interimText 초기화
              setTranscript(e.target.value);
              setInterimText("");
            }}
            placeholder="여기에 답변을 작성하거나 녹음을 통해 채워주세요..."
          />
        </div>

        {/* 오른쪽: 원형 타이머 + 녹음 버튼 */}
        <div className="recorder-container">
          <div className="timer-wrapper">
            <svg className="circular-chart" viewBox="0 0 36 36">
              <path
                className="circle-bg"
                d="M18 2.0845
                   a 15.9155 15.9155 0 0 1 0 31.831
                   a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="circle"
                strokeDasharray={`${(timer / 30) * 100}, 100`}
                d="M18 2.0845
                   a 15.9155 15.9155 0 0 1 0 31.831
                   a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="timer-text">
              <span>⏱ 남은 시간</span>
              <div className="timer-seconds">{timer}</div>
            </div>
          </div>
          <div className="record-buttons">
            <button onClick={startRecording} disabled={isRecording}>
              {isRecording ? "녹음 중..." : "녹음 시작"}
            </button>
            <button onClick={stopRecording} disabled={!isRecording}>
              녹음 중단
            </button>
          </div>
        </div>
      </section>

      {/* 슬라이더 영역: 말더듬 제외 항목 먼저, 마지막에 말더듬 */}
      <section className="sliders-container">
        <label>⚙️ 평가 항목 가중치 조정 (0~5 정수)</label>
        {FEATURES.filter((f) => f.key !== "hesitation").map((feat) => {
          const idx = FEATURES.findIndex((x) => x.key === feat.key);
          return (
            <div key={feat.key} className="slider-item">
              <span className="slider-label">{feat.label}</span>
              <input
                type="range"
                min="0"
                max="5"
                step="1"
                value={weights[idx]}
                onChange={(e) => handleWeightChange(idx, e.target.value)}
                className="slider"
              />
              <span className="slider-value">{weights[idx]}</span>
              {weights[idx] === 0 && <span className="excluded-text">제외됨</span>}
            </div>
          );
        })}
        {/* 말더듬(“hesitation”)만 마지막에 렌더링 */}
        {(() => {
          const hIndex = FEATURES.findIndex((f) => f.key === "hesitation");
          return (
            <div key="hesitation" className="slider-item">
              <span className="slider-label">말더듬</span>
              <input
                type="range"
                min="0"
                max="5"
                step="1"
                value={weights[hIndex]}
                onChange={(e) => handleWeightChange(hIndex, e.target.value)}
                className="slider"
              />
              <span className="slider-value">{weights[hIndex]}</span>
              {weights[hIndex] === 0 && <span className="excluded-text">제외됨</span>}
            </div>
          );
        })()}
      </section>

      {/* 분석 요청 버튼 */}
      <button className="analyze-button" onClick={handleSubmit} disabled={loading}>
        {loading ? "분석 중..." : "분석 요청"}
      </button>

      {/* 결과 표시 */}
      {(rawScore !== null || maxPossible !== null) && (
        <section className="result-section">
          <h3>🔍 결과</h3>

          {/* 1) 점수 요약: 원형 차트 + 퍼센트 + 등급 */}
          <div className="results-summary">
            <div className="score-circle-container">
              <svg viewBox="0 0 36 36" className="score-circle-chart">
                <path
                  className="circle-bg"
                  d="M18 2.0845
                     a 15.9155 15.9155 0 0 1 0 31.831
                     a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="circle"
                  strokeDasharray={`${percent}, 100`}
                  d="M18 2.0845
                     a 15.9155 15.9155 0 0 1 0 31.831
                     a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="score-text">
                <span className="score-value">
                  {maxPossible === 0
                    ? `- ${(FEATURES.length - 1) * MAX_PER_FEATURE}`
                    : `${rawScore} / ${maxPossible}`}
                </span>
                {maxPossible > 0 && <span className="score-percent">{percent}%</span>}
              </div>
            </div>
            <div className="grade-circle-container">
              <svg viewBox="0 0 36 36" className="grade-circle-chart">
                <path
                  className="circle-bg"
                  d="M18 2.0845
                     a 15.9155 15.9155 0 0 1 0 31.831
                     a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                {/* 등급은 텍스트만 */}
              </svg>
              <div className="grade-text">
                <span className="grade-value">{grade}</span>
              </div>
            </div>
          </div>

          {/* 2) 레이더 차트: 말더듬 제외 항목 시각화 */}
          {breakdown.length > 0 && (
            <div className="radar-chart-wrapper">
              <Radar
                data={{
                  labels: breakdown
                    .filter((b) => b.label !== "말더듬")
                    .map((b) => b.label),
                  datasets: [
                    {
                      label: "캡핑 기여도",
                      data: breakdown
                        .filter((b) => b.label !== "말더듬")
                        .map((b) => b.cappedContribution),
                      backgroundColor: "rgba(37, 99, 235, 0.2)",
                      borderColor: "rgba(37, 99, 235, 1)",
                      borderWidth: 2,
                      pointBackgroundColor: "rgba(37, 99, 235, 1)",
                    },
                  ],
                }}
                options={{
                  scales: {
                    r: {
                      min: 0,
                      max: MAX_PER_FEATURE,
                      ticks: {
                        stepSize: 5,
                        backdropColor: "#f9fafb",
                        color: "#374151",
                      },
                      angleLines: { color: "#e5e7eb" },
                      grid: { color: "#e5e7eb" },
                      pointLabels: { color: "#374151", font: { size: 12 } },
                      suggestedMin: 0,
                      suggestedMax: MAX_PER_FEATURE,
                    },
                  },
                  plugins: {
                    legend: {
                      display: false,
                    },
                  },
                  responsive: true,
                }}
              />
            </div>
          )}

          {/* 3) 기여도 테이블 (말더듬을 맨 마지막으로 배치) */}
          <div className="table-wrapper">
            <h4>항목별 기여도</h4>
            <table className="breakdown-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>값</th>
                  <th>가중치</th>
                  <th>원시 기여도</th>
                  <th>캡핑 기여도</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...breakdown.filter((b) => b.label !== "말더듬"),
                  ...breakdown.filter((b) => b.label === "말더듬"),
                ].map((b, idx) => (
                  <tr key={idx}>
                    <td>{b.label}</td>
                    <td>{b.value}</td>
                    <td>{b.weight}</td>
                    <td
                      className={
                        b.label === "말더듬" && b.rawContribution < 0
                          ? "negative"
                          : ""
                      }
                    >
                      {b.rawContribution}
                    </td>
                    <td
                      className={
                        b.label !== "말더듬" && b.cappedContribution >= MAX_PER_FEATURE
                          ? "highlight"
                          : b.label === "말더듬"
                          ? "negative"
                          : ""
                      }
                    >
                      {b.cappedContribution}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 4) AI 피드백 */}
          <div className="feedback-section">
            <h4>AI 피드백</h4>
            <div className="feedback-box">{feedback}</div>
          </div>
        </section>
      )}
    </div>
  );
}
