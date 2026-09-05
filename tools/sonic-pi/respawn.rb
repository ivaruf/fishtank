# Back in the water: rising bubbles and a swoosh.
with_fx :reverb, room: 0.6, mix: 0.35 do
  sample :ambi_swoosh, amp: 0.5, rate: 1.4
  use_synth :sine
  [72, 76, 79, 84, 88, 91].each do |n|
    play n, release: 0.3, amp: 0.35, pan: rrand(-0.5, 0.5)
    sleep 0.07
  end
end
