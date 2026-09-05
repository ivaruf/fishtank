# You were eaten: a dark woosh, a falling wobble and a final flip.
with_fx :reverb, room: 0.7, mix: 0.4 do
  sample :ambi_dark_woosh, amp: 0.9, rate: 1.3
  use_synth :dsaw
  s = play 55, note_slide: 0.7, release: 1.0, cutoff: 85, amp: 0.7
  control s, note: 36
  sleep 0.5
  sample :elec_flip, amp: 0.6, rate: 0.8
end
