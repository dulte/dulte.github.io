// --------------------------------------------------------------------------------------
// Convetion between hex and base64. Thanks to GeorgioWan for the code!
// --------------------------------------------------------------------------------------

// Hex to Base64
function hexToBase64(str) {
    return btoa(String.fromCharCode.apply(null,
      str.replace(/\r|\n/g, "").replace(/([\da-fA-F]{2}) ?/g, "0x$1 ").replace(/ +$/, "").split(" "))
    );
}

// Base64 to Hex
function base64ToHex(str) {
    for (var i = 0, bin = atob(str.replace(/[ \r\n]+$/, "")), hex = []; i < bin.length; ++i) {
        let tmp = bin.charCodeAt(i).toString(16);
        if (tmp.length === 1) tmp = "0" + tmp;
        hex[hex.length] = tmp;
    }
    return hex.join(" ");
}

// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------



// --------------------------------------------------------------------------------------
// Converts all types to string
// --------------------------------------------------------------------------------------

function base64ToAscii(str){
    return atob(str);
}

function asciiToBase64(str){
    return btoa(str);
}

function hexToAscii(str){
    return base64ToAscii(hexToBase64(str));
}

function asciiToHex(str){
    return base64ToHex(asciiToBase64(str));
}


// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------


// --------------------------------------------------------------------------------------
// The almighty XOR
// --------------------------------------------------------------------------------------

function xor(plain, key){
    var result = "";
    let length = plain.length;
    let key_lenght = key.length;

    for(i=0; i<length; i++){
        let xor = plain.charCodeAt(i)^key.charCodeAt(i % key_lenght);
        result += String.fromCharCode(xor)
    }

    return result;

}

// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------


// --------------------------------------------------------------------------------------
// Brute Force Single Character Key
// --------------------------------------------------------------------------------------

function english_score(str){
    // From https://en.wikipedia.org/wiki/Letter_frequency
    // with the exception of ' ', which the authors estimated.
    var character_frequencies = {
        'a': .08167, 'b': .01492, 'c': .02782, 'd': .04253,
        'e': .12702, 'f': .02228, 'g': .02015, 'h': .06094,
        'i': .06094, 'j': .00153, 'k': .00772, 'l': .04025,
        'm': .02406, 'n': .06749, 'o': .07507, 'p': .01929,
        'q': .00095, 'r': .05987, 's': .06327, 't': .09056,
        'u': .02758, 'v': .00978, 'w': .02360, 'x': .00150,
        'y': .01974, 'z': .00074, ' ': .13000
    };
    
    str = str.toLowerCase();
    var sum = 0;
    for(i=0; i<str.length; i++){
        if(str.charAt(i) in character_frequencies)
        sum += character_frequencies[str.charAt(i)];
    }
    
    return sum;
}

function findSingleKeyScores(str){
    var printables = "";
    for(var i=32;i<127;++i) printables += String.fromCharCode(i);
    
    var scores = [];
    var solutions = [];

    for(i=0; i<printables.length; i++){
        let current_solution = xor(str, printables.charAt(i));
        solutions[i] = current_solution;
        scores[i] = english_score(current_solution);
    }

    return [solutions, scores, printables];
}

function findBestSolution(solutions, scores, printables){
    var best_score = -1000;
    var best_solution;
    var key;
    for(i=0; i<solutions.length; i++){
        if(scores[i] > best_score){
            best_score = scores[i];
            best_solution = solutions[i];
            key = printables.charAt(i);
        }
    }
    
    return [best_solution, best_score, key]
}

function breakSingleCharKey(str){
    var scores = findSingleKeyScores(str);
    return findBestSolution(scores[0], scores[1], scores[2]);
}

// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------


// --------------------------------------------------------------------------------------
// Functions for breaking repeating key
// --------------------------------------------------------------------------------------

function hammingDistance(str1, str2){
    var result = 0;

    for(i=0; i<str1.length; i++){
        if(str1.charCodeAt(i) != str2.charCodeAt(i)){
            var bits =  (str1.charCodeAt(i)^str2.charCodeAt(i)).toString(2);
            for(j=0;j<bits.length;j++)
                result += parseInt(bits[j]);
        }
    }

    return result;

}



// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------