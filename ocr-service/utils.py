import re
import time

class HandProcessor:
    """
    Normalization Layer: Cleans OCR noise and maps keywords to standard Poker JSON.
    """
    
    KEYWORD_MAP = {
        # Actions (Vietnamese & Common Typos)
        r'bỏ bài': 'FOLD',
        r'bo bai': 'FOLD',
        r'theo': 'CALL',
        r'tố': 'RAISE',
        r'to': 'RAISE',
        r'tổ': 'RAISE',
        r'cược': 'BET',
        r'cuoc': 'BET',
        r'cugc': 'BET', # OCR typo
        r'check': 'CHECK',
        r'xem bài': 'CHECK',
        r'xem bai': 'CHECK',
        r'all-in': 'ALL-IN',
        r'tất tay': 'ALL-IN',
        r'tat tay': 'ALL-IN',
        
        # UI Elements & Typos
        r'tổng pot': 'TOTAL_POT',
        r'téng pot': 'TOTAL_POT',
        r'tông pot': 'TOTAL_POT',
        r'tong pot': 'TOTAL_POT',
        r'pot': 'TOTAL_POT',
        r'pót': 'TOTAL_POT',
        r'người thắng': 'WINNER',
        r'nguoi thang': 'WINNER',
        r'winner': 'WINNER'
    }

    @staticmethod
    def normalize_currency(text: str) -> str:
        """
        Fixes common OCR errors for BB unit.
        8B, B8, 88 -> BB. 
        Also handles comma/dot confusion (1,947 -> 1.947)
        """
        if not text: return ""
        
        # 1. BB Normalization
        text = re.sub(r'(8B|B8|88|SB|8B|BB)$', 'BB', text, flags=re.IGNORECASE)
        
        # 2. Number normalization: 1.947 BB -> 1.947
        clean_num = re.sub(r'[^\d.,]', '', text)
        
        # 3. Comma vs Dot (European vs US format confusion in OCR)
        # If there's a comma and no dot, or if it looks like thousand separator but in BB context
        if ',' in clean_num and '.' not in clean_num:
            # If it's 1,234 (no decimal) or 1,23 (looks like 1.23)
            # Standardizing to dot
            clean_num = clean_num.replace(',', '.')
            
        return clean_num.strip()

    @staticmethod
    def parse_action_line(line: str):
        """
        Parses a raw OCR line into {player, action, amount}.
        Uses fuzzy keyword matching.
        Example: "kiukiukiu902 : Tố 111 BB" -> {player: "kiukiukiu902", action: "RAISE", amount: 111}
        """
        line = line.strip()
        if not line: return None

        # Clean common noise at start/end
        line = re.sub(r'^[_.*\[\]]+', '', line)
        
        # 1. Detect Action Keyword
        detected_action = "UNKNOWN"
        for pattern, action_name in HandProcessor.KEYWORD_MAP.items():
            if re.search(pattern, line, re.IGNORECASE):
                detected_action = action_name
                break
        
        if detected_action == "UNKNOWN":
            return None # Not an action line or unknown

        # 2. Extract Amount
        amount_match = re.search(r'([\d.,]+)\s*(?:BB|8B|88)?$', line, re.IGNORECASE)
        amount = 0.0
        if amount_match:
            try:
                amount_str = amount_match.group(1).replace(',', '.')
                amount = float(amount_str)
            except:
                pass

        # 3. Extract Player Name (Everything before the first colon or action keyword)
        prefix_parts = re.split(r'[:\-]|' + '|'.join(HandProcessor.KEYWORD_MAP.keys()), line, flags=re.IGNORECASE)
        player_name = prefix_parts[0].strip() if prefix_parts else "unknown"

        return {
            "player": player_name,
            "action": detected_action,
            "amount": amount
        }

    def parse_hand(self, raw_data: dict) -> dict:
        """
        Main entry point for normalizing a full hand.
        raw_data: { 'pot': '1.947 BB', 'board': ['As', 'Kd'], 'actions_raw': ['kiukiukiu902', '9', '9', '+1.128 BB'] }
        """
        # 1. Pot Normalization
        pot_text = raw_data.get('pot', '')
        pot_val = self.normalize_pot_logic(pot_text)
        
        # 2. Board Cards
        board = raw_data.get('board', [])
        
        # We need to format the actions into preflop, flop, turn, river
        actions_by_street = {
            "preflop": [],
            "flop": [],
            "turn": [],
            "river": []
        }
        
        raw_actions = raw_data.get('actions_raw', [])
        
        current_street = "preflop"
        actions_by_street_new = { "preflop": [], "flop": [], "turn": [], "river": [] }
        players_dict = {}
        winner = "unknown"
        
        i = 0
        while i < len(raw_actions):
            line = raw_actions[i].strip().upper()
            if line == 'PRE-FLOP': current_street = 'preflop'; i+=1; continue
            if line == 'FLOP': current_street = 'flop'; i+=1; continue
            if line == 'TURN': current_street = 'turn'; i+=1; continue
            if line == 'RIVER': current_street = 'river'; i+=1; continue
            if line == 'BLINDS & ANTE': i+=1; continue
            
            # Since we already parsed `actions` earlier, we can just match it by player name
            # Or we can just rebuild the actions here using the existing parser:
            parsed = self.parse_action_line(raw_actions[i])
            if parsed:
                # Add to street
                parsed["action"] = parsed["action"].lower()
                actions_by_street_new[current_street].append(parsed)
                p = parsed['player']
                if p not in players_dict: players_dict[p] = {"name": p, "hole_cards": []}
                i += 1
                continue
                
            # If not a basic action, check if it's the complex pattern we used earlier
            if len(raw_actions[i]) >= 3 and i + 2 < len(raw_actions):
                # (Hero hands extraction logic can still run globally as before)
                pass 
                
            # basic 'Player \n Action' pattern
            if i + 1 < len(raw_actions):
                next_line = raw_actions[i+1].strip()
                detected_action = "UNKNOWN"
                for pattern, action_name in self.KEYWORD_MAP.items():
                    if re.search(pattern, next_line, re.IGNORECASE):
                        detected_action = action_name
                        break
                if detected_action != "UNKNOWN":
                    p_name = raw_actions[i].strip() # Player is the current line
                    amount = 0.0
                    jump = 2
                    
                    amount_idx = -1
                    if i + 2 < len(raw_actions) and ('BB' in raw_actions[i+2].upper() or re.match(r'^[\d.,]+$', raw_actions[i+2])):
                        amount_idx = i + 2
                    elif i + 3 < len(raw_actions) and ('BB' in raw_actions[i+3].upper() or re.match(r'^[\d.,]+$', raw_actions[i+3])):
                        amount_idx = i + 3
                        
                    if amount_idx != -1:
                        amt_match = re.search(r'([\d.,]+)', raw_actions[amount_idx])
                        if amt_match:
                            try: amount = float(amt_match.group(1).replace(',', '.'))
                            except: pass
                        jump = amount_idx - i + 1
                    
                    if p_name not in players_dict: players_dict[p_name] = {"name": p_name, "hole_cards": []}
                    
                    if detected_action == "WINNER":
                        # If the action is WINNER, this player is the winner
                        winner = p_name
                        # We don't necessarily append "winner" to actions_by_street_new
                        i += jump
                        continue
                        
                    actions_by_street_new[current_street].append({
                        "player": p_name,
                        "action": detected_action.lower(),
                        "amount": amount
                    })
                    
                    i += jump
                    continue
            i += 1
            
        players_list = list(players_dict.values())

        return {
            "hand_id": f"H{int(time.time())}", 
            "pot": pot_val,
            "board": board,
            "actions": actions_by_street_new,
            "players": players_list,
            "winner": winner
        }

    @staticmethod
    def normalize_pot_logic(text: str) -> float:
        """
        Extracts float value from 'Total Pot: 1.947 BB'
        """
        # Remove any leading 'Total Pot' or 'Tong Pot' text
        text = re.sub(r'Total Pot|Tong Pot|T..ng Pot|:', '', text, flags=re.IGNORECASE)
        clean_val = HandProcessor.normalize_currency(text)
        try:
            return float(clean_val)
        except:
            return 0.0
