(() => {
  const screens = [...document.querySelectorAll(".screen")];
  const boardElement = document.getElementById("chessboard");
  const files = "abcdefgh";
  const glyphs = {
    wk: "♔",
    wq: "♕",
    wr: "♖",
    wb: "♗",
    wn: "♘",
    wp: "♙",
    bk: "♚",
    bq: "♛",
    br: "♜",
    bb: "♝",
    bn: "♞",
    bp: "♟",
  };
  const values = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 20000 };
  const searchDepths = { easy: 1, medium: 2, hard: 3 };
  let difficulty = "medium";
  let minutes = 10;
  let colorChoice = "white";
  let friendMinutes = 10;
  let gameMode = "ai";
  let isRoomHost = false;
  let peer;
  let roomConnection;
  let pendingRoomMove = false;
  let playerColor = "w";
  let aiColor = "b";
  let game;
  let selectedSquare = null;
  let legalTargets = [];
  let lastMove = null;
  let aiThinking = false;
  let clocks = { w: 600, b: 600 };
  let clockActiveColor = "w";
  let clockLastUpdated = 0;
  let clockInterval;
  let aiMoveTimeout;

  function showScreen(id) {
    screens.forEach((screen) =>
      screen.classList.toggle("active", screen.id === id),
    );
  }

  function formatTime(seconds) {
    const wholeSeconds = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  }

  function renderBoard() {
    boardElement.replaceChildren();
    const position = game.board();
    position.forEach((_, rowIndex) => {
      for (let columnIndex = 0; columnIndex < 8; columnIndex++) {
        const actualRow = playerColor === "w" ? rowIndex : 7 - rowIndex;
        const actualColumn =
          playerColor === "w" ? columnIndex : 7 - columnIndex;
        const piece = position[actualRow][actualColumn];
        const squareName = `${files[actualColumn]}${8 - actualRow}`;
        const square = document.createElement("button");
        square.className = `square ${(actualRow + actualColumn) % 2 === 0 ? "light" : "dark"}`;
        square.type = "button";
        square.dataset.square = squareName;
        square.setAttribute("role", "gridcell");
        square.setAttribute(
          "aria-label",
          `${squareName}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}` : ""}`,
        );
        if (selectedSquare === squareName) square.classList.add("selected");
        if (
          lastMove &&
          (lastMove.from === squareName || lastMove.to === squareName)
        ) {
          square.classList.add("last-move");
        }
        if (legalTargets.some((move) => move.to === squareName)) {
          square.classList.add("legal");
          if (piece) square.classList.add("capture");
        }
        if (columnIndex === 0) {
          const rank = document.createElement("span");
          rank.className = "coord";
          rank.textContent = String(8 - actualRow);
          square.append(rank);
        }
        if (rowIndex === 7) {
          const file = document.createElement("span");
          file.className = "coord file-coordinate";
          file.textContent = files[actualColumn];
          square.append(file);
        }
        if (piece) {
          const pieceElement = document.createElement("span");
          pieceElement.className = `piece ${piece.color === "w" ? "white" : "black"}`;
          pieceElement.textContent = glyphs[`${piece.color}${piece.type}`];
          square.append(pieceElement);
        }
        square.addEventListener("click", () => handleSquareClick(squareName));
        boardElement.append(square);
      }
    });
  }

  function updateGameInfo() {
    const activeColor = game.turn();
    const activeIsAi = activeColor === aiColor;
    const opponentName = gameMode === "friend" ? "Friend" : "Chess AI";
    document.getElementById("opponent-label").textContent = opponentName;
    document.getElementById("opponent-name-top").textContent = opponentName;
    document
      .getElementById("opponent-dot")
      .classList.toggle("dark", aiColor === "b");
    document.getElementById("ai-timer").textContent = formatTime(
      clocks[aiColor],
    );
    document.getElementById("you-timer").textContent = formatTime(
      clocks[playerColor],
    );
    document
      .getElementById("ai-timer-card")
      .classList.toggle("active-turn", activeIsAi && !game.game_over());
    document
      .getElementById("you-timer-card")
      .classList.toggle("active-turn", !activeIsAi && !game.game_over());
    document
      .getElementById("ai-timer-card")
      .classList.toggle("expired", clocks[aiColor] <= 0);
    document
      .getElementById("you-timer-card")
      .classList.toggle("expired", clocks[playerColor] <= 0);
    document.getElementById("ai-status").textContent = aiThinking
      ? "Thinking…"
      : activeIsAi && !game.game_over()
        ? "To move"
        : "Waiting";
    document
      .getElementById("ai-player-bar")
      .classList.toggle("thinking", aiThinking);
    const playerName = playerColor === "w" ? "White" : "Black";
    document.getElementById("you-status").textContent =
      !activeIsAi && !game.game_over()
        ? `${playerName} · Your turn`
        : playerName;
    document.getElementById("turn-message").textContent = aiThinking
      ? "The AI is considering its move…"
      : activeIsAi
        ? gameMode === "friend"
          ? "Your friend is to move."
          : "The AI is to move."
        : "Your move. Take your time.";

    const history = game.history();
    const rows = [];
    for (let index = 0; index < history.length; index += 2) {
      rows.push(
        `<div class="move-row"><span class="move-number">${Math.floor(index / 2) + 1}.</span><span>${history[index]}</span><span>${history[index + 1] || ""}</span></div>`,
      );
    }
    const moveList = document.getElementById("move-list");
    moveList.innerHTML = rows.length ? rows.join("") : "Your game starts here.";
    moveList.scrollTop = moveList.scrollHeight;
  }

  function handleSquareClick(square) {
    if (
      !game ||
      game.game_over() ||
      aiThinking ||
      pendingRoomMove ||
      game.turn() !== playerColor
    )
      return;
    const piece = game.get(square);
    if (selectedSquare && legalTargets.some((move) => move.to === square)) {
      if (gameMode === "friend" && !isRoomHost) {
        roomConnection.send({
          type: "move",
          move: { from: selectedSquare, to: square, promotion: "q" },
        });
        selectedSquare = null;
        legalTargets = [];
        pendingRoomMove = true;
        document.getElementById("turn-message").textContent =
          "Move sent. Waiting for confirmation…";
        renderBoard();
        return;
      }
      const move = game.move({
        from: selectedSquare,
        to: square,
        promotion: "q",
      });
      selectedSquare = null;
      legalTargets = [];
      if (move) {
        lastMove = move;
        afterMove();
      }
      return;
    }
    if (piece && piece.color === playerColor) {
      selectedSquare = square;
      legalTargets = game.moves({ square, verbose: true });
    } else {
      selectedSquare = null;
      legalTargets = [];
    }
    renderBoard();
  }

  function syncClock() {
    if (!game || game.game_over()) return true;
    const now = Date.now();
    clocks[clockActiveColor] -= (now - clockLastUpdated) / 1000;
    clockLastUpdated = now;
    if (clocks[clockActiveColor] <= 0) {
      finishGame();
      return false;
    }
    return true;
  }

  function evaluateBoard(position) {
    let score = 0;
    const board = position.board();
    board.forEach((row, rowIndex) =>
      row.forEach((piece, columnIndex) => {
        if (!piece) return;
        const direction = piece.color === "w" ? 1 : -1;
        const centerDistance =
          Math.abs(3.5 - columnIndex) + Math.abs(3.5 - rowIndex);
        let positional = 0;
        if (piece.type === "p") {
          const advancement = piece.color === "w" ? 6 - rowIndex : rowIndex - 1;
          positional =
            advancement * 7 + (3.5 - Math.abs(3.5 - columnIndex)) * 3;
        }
        if (piece.type === "n" || piece.type === "b") {
          positional = (7 - centerDistance) * (piece.type === "n" ? 7 : 4);
        }
        if (piece.type === "q") positional = (7 - centerDistance) * 2;
        if (piece.type === "k" && position.history().length > 20) {
          positional = (7 - centerDistance) * 3;
        }
        score += direction * (values[piece.type] + positional);
      }),
    );
    return (position.turn() === "w" ? 1 : -1) * score;
  }

  function moveOrderScore(move) {
    if (move.captured) return 10 * values[move.captured] - values[move.piece];
    if (move.promotion) return values[move.promotion];
    return 0;
  }

  function search(position, depth, alpha, beta, ply, counter) {
    counter.nodes++;
    if (position.in_checkmate()) return -100000 + ply;
    if (position.in_draw() || position.in_stalemate()) return 0;
    if (depth === 0) return evaluateBoard(position);
    const moves = position
      .moves({ verbose: true })
      .sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
    let best = -Infinity;
    for (const move of moves) {
      position.move(move);
      const score = -search(
        position,
        depth - 1,
        -beta,
        -alpha,
        ply + 1,
        counter,
      );
      position.undo();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseAiMove() {
    const candidates = game
      .moves({ verbose: true })
      .sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
    const depth = searchDepths[difficulty];
    const counter = { nodes: 0 };
    let bestScore = -Infinity;
    let bestMoves = [];
    for (const move of candidates) {
      game.move(move);
      const score = -search(game, depth - 1, -Infinity, Infinity, 1, counter);
      game.undo();
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
    }
    const chosen =
      bestMoves[Math.floor(Math.random() * bestMoves.length)] || candidates[0];
    const delay = Math.min(
      2100,
      280 +
        depth * 100 +
        Math.sqrt(counter.nodes) * (difficulty === "easy" ? 5 : 15),
    );
    return { chosen, delay };
  }

  function scheduleAiMove() {
    if (gameMode !== "ai") return;
    if (game.game_over() || game.turn() !== aiColor) return;
    aiThinking = true;
    updateGameInfo();
    const { chosen, delay } = chooseAiMove();
    aiMoveTimeout = window.setTimeout(() => {
      if (!game || game.game_over() || !syncClock()) return;
      const move = game.move({
        from: chosen.from,
        to: chosen.to,
        promotion: chosen.promotion || "q",
      });
      aiThinking = false;
      lastMove = move;
      afterMove();
    }, delay);
  }

  function afterMove() {
    if (!syncClock()) return;
    clockActiveColor = game.turn();
    clockLastUpdated = Date.now();
    renderBoard();
    updateGameInfo();
    if (game.game_over()) {
      finishGame();
      return;
    }
    if (gameMode === "friend") {
      if (isRoomHost) sendRoomState("state");
      return;
    }
    if (game.turn() === aiColor) scheduleAiMove();
  }

  function finishGame(message, detailOverride, broadcast = true) {
    clearInterval(clockInterval);
    clearTimeout(aiMoveTimeout);
    aiThinking = false;
    let title = message;
    let detail = detailOverride || "Well played.";
    if (!title && game.in_checkmate()) {
      title =
        game.turn() === playerColor
          ? gameMode === "friend"
            ? "Friend wins"
            : "AI wins"
          : "You win";
      detail =
        game.turn() === playerColor
          ? "Checkmate. There is always another game."
          : "Checkmate. A lovely finish.";
    } else if (!title && clocks[playerColor] <= 0) {
      title = gameMode === "friend" ? "Friend wins" : "AI wins";
      detail = "Your time ran out.";
    } else if (!title && clocks[aiColor] <= 0) {
      title = "You win";
      detail =
        gameMode === "friend"
          ? "Your friend ran out of time."
          : "The AI ran out of time.";
    } else if (!title) {
      title = "Draw";
      detail = "A hard-fought game, evenly met.";
    }
    document.getElementById("result-title").textContent = title;
    document.getElementById("result-detail").textContent = detail;
    document.getElementById("result-icon").textContent =
      title === "You win"
        ? "♔"
        : title === "AI wins" || title === "Friend wins"
          ? "♚"
          : "½";
    document.getElementById("game-over").classList.add("show");
    updateGameInfo();
    if (
      gameMode === "friend" &&
      isRoomHost &&
      broadcast &&
      roomConnection?.open
    ) {
      const winnerColor = game.in_checkmate()
        ? game.turn() === "w"
          ? "b"
          : "w"
        : clocks[playerColor] <= 0
          ? aiColor
          : clocks[aiColor] <= 0
            ? playerColor
            : title === "You win"
              ? playerColor
              : title === "Friend wins"
                ? aiColor
                : null;
      sendRoomState("state");
      roomConnection.send({ type: "finished", title, detail, winnerColor });
    }
  }

  function setRoomStatus(message) {
    document.getElementById("room-connection-status").textContent = message;
  }

  function showRoomError(elementId, message) {
    document.getElementById(elementId).textContent = message;
  }

  function createRoomCode() {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return String(1000 + (bytes[0] % 9000));
  }

  function prepareFriendGame(host, code) {
    gameMode = "friend";
    isRoomHost = host;
    playerColor = host ? "w" : "b";
    aiColor = host ? "b" : "w";
    game = new Chess();
    selectedSquare = null;
    legalTargets = [];
    lastMove = null;
    pendingRoomMove = false;
    aiThinking = false;
    clocks = { w: friendMinutes * 60, b: friendMinutes * 60 };
    clockActiveColor = "w";
    clockLastUpdated = Date.now();
    document.getElementById("game-over").classList.remove("show");
    document.getElementById("opponent-label").textContent = "Friend";
    document.getElementById("opponent-name-top").textContent = "Friend";
    document.getElementById("match-description").textContent = host
      ? `${friendMinutes} minutes each · You play White`
      : "Friend game · You play Black";
    document.getElementById("room-share").hidden = false;
    document.getElementById("room-code-display").textContent = code;
    setRoomStatus(host ? "Opening your room…" : "Connecting to your friend…");
    renderBoard();
    updateGameInfo();
    showScreen("game-screen");
  }

  function roomSnapshot() {
    return {
      fen: game.fen(),
      moves: game.history({ verbose: true }).map((move) => ({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      })),
      clocks: { ...clocks },
      clockActiveColor,
      minutes: friendMinutes,
    };
  }

  function sendRoomState(type = "state") {
    if (!roomConnection?.open) return;
    roomConnection.send({ type, state: roomSnapshot() });
  }

  function applyRoomState(state) {
    const synchronizedGame = new Chess();
    state.moves.forEach((move) => synchronizedGame.move(move));
    game = synchronizedGame;
    clocks = { ...state.clocks };
    clockActiveColor = state.clockActiveColor;
    clockLastUpdated = Date.now();
    friendMinutes = state.minutes;
    pendingRoomMove = false;
    lastMove = game.history({ verbose: true }).slice(-1)[0] || null;
    document.getElementById("match-description").textContent =
      `${friendMinutes} minutes each · You play ${playerColor === "w" ? "White" : "Black"}`;
    setRoomStatus("Connected · playing now");
    renderBoard();
    updateGameInfo();
  }

  function startRoomClock() {
    clearInterval(clockInterval);
    clockLastUpdated = Date.now();
    clockInterval = window.setInterval(() => {
      if (!isRoomHost || !game || game.game_over()) return;
      if (!syncClock()) return;
      updateGameInfo();
      sendRoomState("state");
    }, 1000);
  }

  function restartFriendGame() {
    game = new Chess();
    clocks = { w: friendMinutes * 60, b: friendMinutes * 60 };
    clockActiveColor = "w";
    clockLastUpdated = Date.now();
    lastMove = null;
    selectedSquare = null;
    legalTargets = [];
    pendingRoomMove = false;
    document.getElementById("game-over").classList.remove("show");
    startRoomClock();
    renderBoard();
    updateGameInfo();
    sendRoomState("state");
  }

  function attachRoomConnection(connection, host) {
    roomConnection = connection;
    connection.on("open", () => {
      if (host) {
        setRoomStatus("Friend joined · you are White");
        clockActiveColor = game.turn();
        startRoomClock();
        sendRoomState("start");
      } else {
        setRoomStatus("Connected · waiting for the host");
      }
    });
    connection.on("data", (message) => {
      if (!message || typeof message !== "object") return;
      if (
        host &&
        message.type === "move" &&
        message.move &&
        game.turn() === "b"
      ) {
        const move = game.move(message.move);
        if (move) {
          lastMove = move;
          afterMove();
        }
      } else if (host && message.type === "resign") {
        finishGame("You win", "Your friend resigned.");
      } else if (host && message.type === "opponent-left") {
        finishGame("You win", "Your friend disconnected.");
      } else if (host && message.type === "restart") {
        restartFriendGame();
      } else if (
        !host &&
        (message.type === "start" || message.type === "state")
      ) {
        applyRoomState(message.state);
        if (message.type === "start") startRoomClock();
      } else if (!host && message.type === "finished") {
        const remoteTitle = message.winnerColor
          ? message.winnerColor === playerColor
            ? "You win"
            : "Friend wins"
          : message.title;
        const remoteDetail =
          message.detail === "Your friend resigned."
            ? "You resigned."
            : message.detail === "You resigned."
              ? "Your friend resigned."
              : message.detail;
        finishGame(remoteTitle, remoteDetail, false);
      } else if (!host && message.type === "opponent-left") {
        finishGame("Friend left", "The other player disconnected.", false);
      }
    });
    connection.on("close", () => {
      if (host && gameMode === "friend" && game && !game.game_over()) {
        finishGame("You win", "Your friend disconnected.", false);
      } else {
        setRoomStatus("Connection closed");
      }
    });
    connection.on("error", () =>
      setRoomStatus("Connection problem · check the room code"),
    );
  }

  function createFriendRoom() {
    showRoomError("create-room-error", "");
    if (typeof Peer === "undefined") {
      showRoomError(
        "create-room-error",
        "Room connections could not load. Check your internet connection and try again.",
      );
      return;
    }
    friendMinutes = Number(
      document.querySelector("[data-friend-minutes].selected").dataset
        .friendMinutes,
    );
    const code = createRoomCode();
    prepareFriendGame(true, code);

    function openPeer(roomCode, attempt = 0) {
      peer = new Peer(roomCode);
      peer.on("open", () =>
        setRoomStatus("Room ready · waiting for a friend to join"),
      );
      peer.on("connection", (connection) => {
        if (roomConnection) {
          connection.close();
          return;
        }
        attachRoomConnection(connection, true);
      });
      peer.on("error", (error) => {
        if (error.type === "unavailable-id" && attempt < 8) {
          peer.destroy();
          const nextCode = createRoomCode();
          document.getElementById("room-code-display").textContent = nextCode;
          openPeer(nextCode, attempt + 1);
        } else {
          setRoomStatus("Could not create the room · try again");
        }
      });
    }
    openPeer(code);
  }

  function joinFriendRoom() {
    showRoomError("join-room-error", "");
    const code = document.getElementById("room-code-input").value.trim();
    if (!/^\d{4}$/.test(code)) {
      showRoomError("join-room-error", "Enter the four-digit room code.");
      return;
    }
    if (typeof Peer === "undefined") {
      showRoomError(
        "join-room-error",
        "Room connections could not load. Check your internet connection and try again.",
      );
      return;
    }
    prepareFriendGame(false, code);
    peer = new Peer();
    peer.on("open", () => {
      const connection = peer.connect(code, { reliable: true });
      attachRoomConnection(connection, false);
      connection.on("open", () =>
        setRoomStatus("Connected · waiting for the host"),
      );
      window.setTimeout(() => {
        if (!connection.open) {
          showRoomError(
            "join-room-error",
            "Could not reach that room. Check the code and try again.",
          );
          setRoomStatus("Still waiting · check the code or network");
        }
      }, 10000);
    });
    peer.on("error", (error) => {
      showRoomError(
        "join-room-error",
        error.type === "peer-unavailable"
          ? "No room found with that code. Check it with your friend."
          : "Could not connect. Check your internet connection and try again.",
      );
      setRoomStatus("Connection failed");
    });
  }

  function cleanupRoom() {
    clearInterval(clockInterval);
    clearTimeout(aiMoveTimeout);
    gameMode = "none";
    if (roomConnection?.open) roomConnection.send({ type: "opponent-left" });
    roomConnection?.close();
    peer?.destroy();
    peer = null;
    roomConnection = null;
    pendingRoomMove = false;
    document.getElementById("room-share").hidden = true;
  }

  function startGame() {
    if (typeof Chess === "undefined") {
      alert(
        "The chess rules library could not load. Check your internet connection and reload the page.",
      );
      return;
    }
    cleanupRoom();
    gameMode = "ai";
    clearInterval(clockInterval);
    clearTimeout(aiMoveTimeout);
    playerColor =
      colorChoice === "random"
        ? Math.random() < 0.5
          ? "w"
          : "b"
        : colorChoice === "white"
          ? "w"
          : "b";
    aiColor = playerColor === "w" ? "b" : "w";
    game = new Chess();
    selectedSquare = null;
    legalTargets = [];
    lastMove = null;
    aiThinking = false;
    clocks = { w: minutes * 60, b: minutes * 60 };
    clockActiveColor = game.turn();
    clockLastUpdated = Date.now();
    document.getElementById("game-over").classList.remove("show");
    const playerName = playerColor === "w" ? "White" : "Black";
    document.getElementById("match-description").textContent =
      `${difficulty[0].toUpperCase()}${difficulty.slice(1)} · ${minutes} minutes each · You play ${playerName}`;
    renderBoard();
    updateGameInfo();
    clockInterval = window.setInterval(() => {
      if (!syncClock()) return;
      updateGameInfo();
    }, 1000);
    showScreen("game-screen");
    if (game.turn() === aiColor) scheduleAiMove();
  }

  document
    .getElementById("start-button")
    .addEventListener("click", () => showScreen("setup-screen"));
  document
    .getElementById("friend-mode-button")
    .addEventListener("click", () => showScreen("friend-menu-screen"));
  document
    .getElementById("friend-menu-back")
    .addEventListener("click", () => showScreen("welcome-screen"));
  document
    .getElementById("friend-create-menu-button")
    .addEventListener("click", () => showScreen("friend-create-screen"));
  document
    .getElementById("friend-join-menu-button")
    .addEventListener("click", () => showScreen("friend-join-screen"));
  document
    .getElementById("friend-create-back")
    .addEventListener("click", () => showScreen("friend-menu-screen"));
  document
    .getElementById("friend-join-back")
    .addEventListener("click", () => showScreen("friend-menu-screen"));
  document
    .getElementById("create-room-button")
    .addEventListener("click", createFriendRoom);
  document
    .getElementById("join-room-button")
    .addEventListener("click", joinFriendRoom);
  document
    .getElementById("room-code-input")
    .addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
    });
  document
    .getElementById("copy-room-code")
    .addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(
          document.getElementById("room-code-display").textContent,
        );
        document.getElementById("copy-room-code").textContent = "Copied";
      } catch {
        setRoomStatus("Select and copy the code to share it");
      }
    });
  document
    .getElementById("welcome-back")
    .addEventListener("click", () => showScreen("welcome-screen"));
  document.getElementById("play-button").addEventListener("click", startGame);
  document.getElementById("new-game-header").addEventListener("click", () => {
    const wasFriendGame = gameMode === "friend";
    cleanupRoom();
    document.getElementById("game-over").classList.remove("show");
    showScreen(wasFriendGame ? "friend-menu-screen" : "setup-screen");
  });
  document.getElementById("restart-button").addEventListener("click", () => {
    if (gameMode !== "friend") {
      startGame();
    } else if (isRoomHost) {
      restartFriendGame();
    } else {
      roomConnection?.send({ type: "restart" });
      setRoomStatus("Restart requested from the room leader");
    }
  });
  document.getElementById("resign-button").addEventListener("click", () => {
    if (gameMode === "friend" && !isRoomHost) {
      roomConnection?.send({ type: "resign" });
      finishGame("You resigned", "Your friend wins.", false);
    } else if (gameMode === "friend") {
      finishGame("Friend wins", "You resigned.");
    } else {
      finishGame("AI wins");
    }
  });
  document.getElementById("result-new-game").addEventListener("click", () => {
    const wasFriendGame = gameMode === "friend";
    if (wasFriendGame) {
      cleanupRoom();
      showScreen("friend-menu-screen");
    } else {
      startGame();
    }
  });

  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      difficulty = button.dataset.difficulty;
      document.querySelectorAll("[data-difficulty]").forEach((option) => {
        option.classList.toggle("selected", option === button);
      });
    });
  });
  document.querySelectorAll("[data-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      minutes = Number(button.dataset.minutes);
      document.querySelectorAll("[data-minutes]").forEach((option) => {
        option.classList.toggle("selected", option === button);
      });
    });
  });
  document.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      colorChoice = button.dataset.color;
      document.querySelectorAll("[data-color]").forEach((option) => {
        option.classList.toggle("selected", option === button);
        option.setAttribute("aria-pressed", String(option === button));
      });
    });
  });
  document.querySelectorAll("[data-friend-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      friendMinutes = Number(button.dataset.friendMinutes);
      document.querySelectorAll("[data-friend-minutes]").forEach((option) => {
        option.classList.toggle("selected", option === button);
      });
    });
  });
})();
