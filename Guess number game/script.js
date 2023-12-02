var correctGuess = 0;
var guessesTaken = 0;
var maxGuesses = 7;
var gameDone = 0;

var newGame = function() { 
  var lbl = document.getElementById('inputLabel');
  lbl.innerHTML = " ";
  guessesTaken = 0;
  correctGuess = Math.floor((Math.random() * 100)+1);
};

newGame();

var btnReset = document.getElementById('btnReset');
btnReset.onclick = newGame;

var response = function(txtGuess) {
  var answer;
  
  while (guessesTaken < maxGuesses && gameDone == 0) {
    if (txtGuess == correctGuess) {
      answer = "Correct! ";
    } else if (txtGuess < correctGuess && txtGuess > 0) {
      answer = "Higher, ";
    } else if (txtGuess > correctGuess && txtGuess < 101) {
      answer = "Lower, ";
    } else {
      answer = "Enter a number, ";
      return answer; /*exit loop to prevent increasing guessesTaken*/
    }
    
    guessesTaken += 1;
    return answer;
  }
  
  return "New game?";
};

var btnSubmit = document.getElementById('btnSubmit');
btnSubmit.onclick = function(e) {
  var txtGuess = document.getElementById('guess').value;
  var answer = response(txtGuess);
  var remainingMessage = (maxGuesses - guessesTaken).toString() + " guess(es) remain"; 
  var lbl = document.getElementById('inputLabel');
  if (gameDone == 0) {
    if (answer == "Correct! ") {
      lbl.innerHTML += answer + "<p> Play again </p>";
      gameDone = 1;
    } else if (guessesTaken == maxGuesses) {
      lbl.innerHTML += "<p> You lost. New game? </p>";
      gameDone = 1;
    } else {
      lbl.innerHTML += "<span id='response'>" + txtGuess + "</span>" + answer + remainingMessage + "<br />";
    }
  }
  var txtGuess = document.getElementById('guess');
  txtGuess.value = null;
  return false;
};
