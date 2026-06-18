// --- 1. 初始化 Matter.js 模組 ---
const { Engine, World, Bodies, Body, Composite } = Matter;
const engine = Engine.create({ gravity: { x: 0, y: 0 } }); // 俯視角，重力為 0

// --- 2. 畫布與變數設定 ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
// 【修正】將物理世界的邏輯座標改為正方形，以完美適應太極圖案
canvas.width = 800;
canvas.height = 800;

const ARENA_CENTER = { x: 400, y: 400 };
const ARENA_RADIUS = 380; // 將戰鬥半徑擴大以撐滿畫面

let baguaData = null;
const baguaKeys = ["乾", "坤", "震", "巽", "坎", "離", "艮", "兌"];

// 玩家狀態包
let p1State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null };
let p2State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null };

// 時空凝結控制狀態
let isTimeFrozen = false;
let freezeTarget = null;
let freezeText = "";
let freezeAlpha = 1.0;

// --- 3. 非同步載入八卦 JSON 資料檔 ---
fetch('bagua.json')
    .then(response => response.json())
    .then(data => {
        baguaData = data;
        initGame();
    })
    .catch(err => console.error("無法讀取卦象設定檔", err));

function initGame() {
    // 建立無形的外牆防止物體飛出邊界
    const wallOptions = { isStatic: true, render: { visible: false } };
    World.add(engine.world, [
        Bodies.rectangle(400, -10, 800, 20, wallOptions),
        Bodies.rectangle(400, 810, 800, 20, wallOptions),
        Bodies.rectangle(-10, 400, 20, 800, wallOptions),
        Bodies.rectangle(810, 400, 20, 800, wallOptions)
    ]);

    // 啟動渲染與碰撞監聽
    setupCollisionListener();
    requestAnimationFrame(drawGame);
}

// --- 4. 點擊監聽控制：支援手機觸控與 RWD 縮放換算 ---
// 【修正】使用 pointerdown 取代 click，確保手機與滑鼠皆可觸發
canvas.addEventListener('pointerdown', (e) => {
    if (!baguaData) return;
    const rect = canvas.getBoundingClientRect();
    
    // 計算 CSS 縮放比例，讓手機點擊能正確對應到 800x800 的邏輯座標
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // 左半邊歸 P1，右半邊歸 P2
    if (mouseX < 400) {
        handlePlayerInput(p1State, 200, 400, "P1");
    } else {
        handlePlayerInput(p2State, 600, 400, "P2");
    }
});

function handlePlayerInput(player, spawnX, spawnY, label) {
    if (player.body) return; // 戰鬥中不可重複生成

    const randomGua = baguaKeys[Math.floor(Math.random() * baguaKeys.length)];

    if (!player.upper) {
        player.upper = randomGua;
    } else if (!player.lower) {
        player.lower = randomGua;
        spawnTop(player, spawnX, spawnY, label);
    }
}

// 實體化產生陀螺刚體
function spawnTop(player, x, y, label) {
    const up = baguaData[player.upper].upper;
    const lo = baguaData[player.lower].lower;
    const radius = 32;

    let topBody;
    // 0 代表圓形，其餘數字代表多邊形頂點數
    if (up.sides === 0) {
        topBody = Bodies.circle(x, y, radius, { label: label });
    } else {
        topBody = Bodies.polygon(x, y, up.sides, radius, { label: label });
    }

    // 寫入二合一的混血物理參數
    Body.setMass(topBody, lo.mass);
    topBody.restitution = lo.restitution;
    topBody.friction = lo.friction;
    topBody.frictionAir = up.frictionAir;

    // 給予初始自轉角速度與直指中心的衝擊力
    Body.setAngularVelocity(topBody, up.angularVelocity);
    const angleToCenter = Math.atan2(ARENA_CENTER.y - y, ARENA_CENTER.x - x);
    Body.setVelocity(topBody, {
        x: Math.cos(angleToCenter) * 5,
        y: Math.sin(angleToCenter) * 5
    });

    player.body = topBody;
    player.currentUpper = player.upper;
    player.currentLower = player.lower;

    World.add(engine.world, topBody);
}

// --- 5. 碰撞事件：觸發時空凝結子彈時間 ---
function setupCollisionListener() {
    Matter.Events.on(engine, 'collisionStart', (event) => {
        if (isTimeFrozen) return;

        event.pairs.forEach(pair => {
            const labelA = pair.bodyA.label;
            const labelB = pair.bodyB.label;

            // 確保是兩隻陀螺互撞
            if ((labelA === "P1" || labelA === "P2") && (labelB === "P1" || labelB === "P2")) {
                const speed = pair.collision.speed || 4;
                const impulse = pair.collision.depth * speed;

                if (impulse > 1.2) { // 衝擊力閾值達標
                    const targetBody = Math.random() > 0.5 ? pair.bodyA : pair.bodyB;
                    const nextGua = baguaKeys[Math.floor(Math.random() * baguaKeys.length)];
                    startTimeFreeze(targetBody, nextGua);
                }
            }
        });
    });
}

function startTimeFreeze(body, nextGua) {
    isTimeFrozen = true;
    freezeTarget = body;
    freezeAlpha = 1.0;
    freezeText = `${body.label} 爻動 ➔ 突變【${nextGua}】卦！`;

    // 時間流速縮小至 5% 的微觀世界
    engine.timing.timeScale = 0.05;

    setTimeout(() => {
        engine.timing.timeScale = 1.0; // 恢復正常時空
        isTimeFrozen = false;
        
        // 執行突變物理向量推力
        if (p1State.body && p2State.body) {
            applyThrustVector(body, nextGua);
        }
        freezeTarget = null;
    }, 600); // 凝結 600 毫秒
}

// 根據爻變後的新卦象，強行注入物理向量特徵
function applyThrustVector(body, newGua) {
    const pState = (body.label === "P1") ? p1State : p2State;
    const oppState = (body.label === "P1") ? p2State : p1State;
    if (!oppState.body) return;

    pState.currentUpper = newGua; // 上卦發生突變改寫

    const opponent = oppState.body;
    // 計算指向對手的向量
    const vectorToOpp = Matter.Vector.sub(opponent.position, body.position);
    const normDir = Matter.Vector.normalise(vectorToOpp);

    switch (newGua) {
        case "震": // 雷 ➔ 直線爆衝
            Body.setVelocity(body, Matter.Vector.mult(normDir, 15));
            Body.setAngularVelocity(body, 0.45);
            break;
        case "離": // 火 ➔ 四向炸裂
            const randomAngle = Math.random() * Math.PI * 2;
            Body.setVelocity(body, { x: Math.cos(randomAngle) * 11, y: Math.sin(randomAngle) * 11 });
            Body.setVelocity(opponent, Matter.Vector.mult(normDir, 9)); // 震開對方
            break;
        case "艮": // 山 ➔ 止步定型、質量暴增
            Body.setVelocity(body, { x: 0, y: 0 });
            Body.setMass(body, body.mass * 4);
            break;
        case "巽": // 風 ➔ 極限自轉，以柔克剛
            Body.setAngularVelocity(body, 0.5);
            body.frictionAir = 0.0001;
            break;
        default: // 其餘卦象給予基本反彈向量
            Body.setVelocity(body, Matter.Vector.mult(normDir, -6));
            break;
    }
}

// --- 6. 生存模式判定：出界或力竭 ---
function checkSurvival(player) {
    if (!player.body) return;

    const pos = player.body.position;
    const distance = Math.hypot(pos.x - ARENA_CENTER.x, pos.y - ARENA_CENTER.y);

    // 條件一：被撞出圓形擂台 (Ring Out)
    // 條件二：自轉角速度趨近於零 (Spin Finish / 氣數已盡)
    if (distance > ARENA_RADIUS || Math.abs(player.body.angularVelocity) < 0.002) {
        World.remove(engine.world, player.body);
        player.body = null;
        player.upper = null;
        player.lower = null;
    }
}

// --- 7. 手動 Canvas 渲染與 UI 更新循環 ---
function drawGame() {
    // 物理引擎計時步進
    Engine.update(engine, 1000 / 60);

    if (!isTimeFrozen) {
        checkSurvival(p1State);
        checkSurvival(p2State);
    }

    // A. 渲染背景底層 (3D 太極競技場)
    if (isTimeFrozen) {
        ctx.fillStyle = "#0a0a0a"; // 凝結時的深淵
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 建立立體凹陷漸層
        let arenaGradient = ctx.createRadialGradient(
            ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS * 0.8,
            ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS
        );
        arenaGradient.addColorStop(0, "rgba(255,255,255,0)");
        arenaGradient.addColorStop(1, "rgba(0,0,0,0.6)"); // 邊緣加深產生碗狀凹陷感

        ctx.save();
        // 畫太極右半邊 (陽)
        ctx.beginPath();
        ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS, -Math.PI/2, Math.PI/2);
        ctx.fillStyle = "#e0e0e0";
        ctx.fill();
        
        // 畫太極左半邊 (陰)
        ctx.beginPath();
        ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS, Math.PI/2, -Math.PI/2);
        ctx.fillStyle = "#333333";
        ctx.fill();

        // 太極雙魚眼
        ctx.beginPath();
        ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y - ARENA_RADIUS/2, ARENA_RADIUS/2, 0, Math.PI*2);
        ctx.fillStyle = "#333333";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y + ARENA_RADIUS/2, ARENA_RADIUS/2, 0, Math.PI*2);
        ctx.fillStyle = "#e0e0e0";
        ctx.fill();
        
        // 疊加上立體陰影漸層
        ctx.beginPath();
        ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS, 0, Math.PI*2);
        ctx.fillStyle = arenaGradient;
        ctx.fill();
        ctx.restore();
    }

    // B. 遍歷並手動繪製所有 Matter.js 刚體 (陀螺)
    const bodies = Composite.allBodies(engine.world);
    bodies.forEach(body => {
        if (body.isStatic) return; // 忽略邊界隱形牆

        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);

        // 依據剛體幾何頂點數據拉線繪製外觀
        ctx.beginPath();
        body.vertices.forEach((vertex, index) => {
            if (index === 0) ctx.moveTo(vertex.x - body.position.x, vertex.y - body.position.y);
            else ctx.lineTo(vertex.x - body.position.x, vertex.y - body.position.y);
        });
        ctx.closePath();

        // 【新增】為陀螺加上立體陰影
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;

        // 配置陣營色彩與特效色彩
        if (isTimeFrozen) {
            ctx.fillStyle = (body === freezeTarget) ? "#f1c40f" : "#444444";
            ctx.strokeStyle = "#ffffff";
        } else {
            ctx.fillStyle = (body.label === "P1") ? "#c0392b" : "#2980b9";
            ctx.strokeStyle = "#111111";
        }
        ctx.lineWidth = 2;
        ctx.fill();
        
        // 關閉陰影以免影響邊框與文字
        ctx.shadowColor = "transparent";
        ctx.stroke();

        // 逆轉角度繪製直立文字
        ctx.rotate(-body.angle);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const pState = (body.label === "P1") ? p1State : p2State;
        ctx.fillText(`${pState.currentUpper}${pState.currentLower}`, 0, 0);

        ctx.restore();
    });

    // C. 渲染時空凝結書法字
    if (isTimeFrozen && freezeTarget) {
        ctx.save();
        ctx.font = "bold 42px serif";
        ctx.fillStyle = `rgba(255, 255, 255, ${freezeAlpha})`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(241, 196, 15, 0.6)";
        ctx.shadowBlur = 12;
        ctx.fillText(freezeText, 400, 200);
        ctx.restore();
        freezeAlpha -= 0.012; // 文字緩慢淡出
    }

    // D. 靜態介面文本渲染
    drawUI();

    requestAnimationFrame(drawGame);
}

function drawUI() {
    ctx.fillStyle = isTimeFrozen ? "#888" : "#aaaaaa";
    ctx.font = "bold 16px sans-serif";
    
    // P1 UI 文字 (左上角)
    ctx.textAlign = "left";
    ctx.fillText("【P1 陣地】", 20, 40);
    let p1Txt = p1State.body ? `正在對戰: ${p1State.currentUpper}${p1State.currentLower}` : 
                (p1State.upper ? `已選上卦【${p1State.upper}】，再點選下卦` : "雙擊起卦...");
    ctx.fillText(p1Txt, 20, 70);

    // P2 UI 文字 (右上角)
    ctx.textAlign = "right";
    ctx.fillText("【P2 陣地】", canvas.width - 20, 40);
    let p2Txt = p2State.body ? `正在對戰: ${p2State.currentUpper}${p2State.currentLower}` : 
                (p2State.upper ? `已選上卦【${p2State.upper}】，再點選下卦` : "雙擊起卦...");
    ctx.fillText(p2Txt, canvas.width - 20, 70);
}