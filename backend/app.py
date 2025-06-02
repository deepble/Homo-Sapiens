# backend/app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import random

app = Flask(__name__)
CORS(app)

QUESTION_LIST = [
    "본인에 대해 간단히 소개해 주세요.",
    "우리 회사에 지원하게 된 동기는 무엇인가요?",
    "본인의 강점과 약점은 무엇이라고 생각하나요?",
    "본인의 가치관을 형성한 경험은 무엇인가요?",
    "이 직무를 수행하는 데 필요한 역량은 무엇이라고 생각하나요?",
    "관련 경험 중 가장 기억에 남는 프로젝트는 무엇인가요?",
    "어려운 문제를 해결했던 경험을 말해 주세요.",
    "팀원과의 의견 충돌을 조율한 경험이 있다면?",
    "우리 회사에 대해 아는 대로 말해보세요.",
    "가장 존경하는 인물과 그 이유는?",
    "동료가 비윤리적인 행동을 했을 때 어떻게 하시겠습니까?"
]

@app.route("/question", methods=["GET"])
def get_question():
    selected = random.choice(QUESTION_LIST)
    return jsonify({"question": selected})


@app.route("/compute", methods=["POST"])
def compute():
    """
    클라이언트로부터 JSON:
      {
        "publicKey": { "n": "<stringified n>", "g": "<stringified g>" },
        "encryptedFeatures": ["<c0>", "<c1>", ..., "<c5>"],
        "weights": ["<w0_int>", "<w1_int>", ..., "<w5_int>"]
      }

    - 서버는 요소별 동형곱(encrypted_feature_i ^ weight_i mod n^2)만 수행합니다.
    - 디버그용으로, 중간 단계별 c_i, w_i, encryptedContrib_i 값을 콘솔에 출력하고,
      반환 JSON에도 "debug" 필드로 포함하여 리턴합니다.
    """

    try:
        data = request.get_json()

        # 1) 공개키 복원
        n = int(data["publicKey"]["n"])
        g = int(data["publicKey"]["g"])  # Paillier에서 보통 g=n+1, 클라이언트가 보내준 값을 그대로 사용
        n_sq = n * n

        # 2) 암호화된 feature 벡터 복원 (문자열 → BigInt(int))
        encrypted_features = [int(c_str) for c_str in data["encryptedFeatures"]]

        # 3) 평문 가중치 벡터 복원 (문자열 → int)
        weights = [int(w_str) for w_str in data["weights"]]

        # 디버그용 데이터 저장용 리스트
        debug_entries = []

        # 4) 요소별 동형곱: c_i^w_i mod n^2
        encrypted_contributions = []
        for i, (c_val, w_val) in enumerate(zip(encrypted_features, weights)):
            # 콘솔 로그로 원본 c_i, w_i 출력
            print(f"[DEBUG] index={i} | encryptedFeature (c_i): {c_val}")
            print(f"[DEBUG] index={i} | weight (w_i): {w_val}")

            # 암호화된 기여도: pow(ciphertext, weight, n^2)
            ec = pow(c_val, w_val, n_sq)
            encrypted_contributions.append(str(ec))

            # 콘솔 로그로 결과 c_i^w_i 출력
            print(f"[DEBUG] index={i} | encryptedContribution (c_i^w_i mod n^2): {ec}")

            # "debug_entries"에도 값 저장 (문자열 형태)
            debug_entries.append({
                "index": i,
                "c_i": str(c_val),
                "w_i": str(w_val),
                "encryptedContribution_i": str(ec)
            })

        # 5) 결과 반환: 암호화된 기여도 벡터 + 디버그용 정보
        return jsonify({
            "encryptedContributions": encrypted_contributions,
            "debug": debug_entries  # ← 디버그용 정보 추가
        })

    except Exception as e:
        return jsonify({"error": f"서버 오류: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
