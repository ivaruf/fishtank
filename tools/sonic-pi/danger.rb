# A predator is close: a low double pulse.
with_fx :lpf, cutoff: 70 do
  with_fx :reverb, room: 0.6, mix: 0.3 do
    use_synth :growl
    play 38, attack: 0.05, sustain: 0.3, release: 0.8, amp: 0.8
    sleep 0.45
    play 38, attack: 0.05, sustain: 0.3, release: 1.0, amp: 0.6
  end
end
