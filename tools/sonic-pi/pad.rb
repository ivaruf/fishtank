# A zapper pad lights up: a short bright beep.
with_fx :reverb, room: 0.4, mix: 0.25 do
  use_synth :beep
  play 84, release: 0.18, amp: 0.6
  sleep 0.08
  play 91, release: 0.22, amp: 0.45
end
